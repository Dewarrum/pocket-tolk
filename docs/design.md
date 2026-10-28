# Pocket Tolk — Design

Status: agreed 2026-10-26. Everything here was decided in a design interview; change it deliberately, not by drift.

## 1. What it is

Pocket Tolk is a personal, mobile-first web app that interprets a face-to-face conversation between two people who share one phone. A session has two languages. Each person presses the same record button, speaks in their own language, reviews the recognised text, and sends it. The app detects which of the two languages was spoken, translates into the other one, shows the translation large, and speaks it aloud.

Non-goals for v1: user accounts, two-device sessions, streaming transcription, audio storage, settings UI, model comparison UI, custom domain, end-to-end browser tests.

## 2. User flow

1. Home screen lists past sessions (date, language pair). Actions: open, delete, "New session".
2. New session: two language pickers from the supported list (section 9). No languages are pinned on first launch; languages that have been used are pinned at the top afterwards.
3. Session screen: list of turns (source text, detected language, translation) and one large record button.
4. Recording: the button shows a timer and a microphone level meter. Max clip length is 2 minutes; at the limit the clip auto-stops. Pressing the button stops recording. Nothing is sent to translation yet.
5. Transcribing: the clip is uploaded; the recognised text appears in an editable field.
6. Review: three actions.
   - Send: runs detection + translation, then speech.
   - Record again: discards the text and records a new clip.
   - Add more: records another clip; its transcript is appended to the current (possibly edited) text with a space. The current text is passed to the recogniser as a hint.
7. Translating: the turn appears in the list; translation text replaces a spinner when ready.
8. Speaking: the translation is played automatically; a replay button stays on the turn.
9. Failure: a failed stage shows the error on the turn with a Retry button that re-runs only that stage. Reviewed text is never lost. If transcription fails, the review step shows the error with Record again.
10. The other person presses the same button and the flow repeats in their language.

## 3. Architecture

Two independently deployable parts in one public GitHub repository, `Dewarrum/pocket-tolk`.

```
pocket-tolk/
  backend/            Go service (module github.com/Dewarrum/pocket-tolk/backend)
    cmd/server/       main: config load, router, server
    internal/
      config/         env parsing, defaults, validation
      httpapi/        handlers, middleware (auth, CORS, limits, logging), error envelope
      languages/      supported-language table with Cartesia voice ids
      stt/            OpenAI-shaped transcription client
      translate/      OpenRouter chat client, prompt, structured output, fallback
      tts/            Cartesia text-to-speech client
    Dockerfile        multi-stage, scratch/distroless final image
  frontend/           React + TypeScript + Vite PWA
    src/
      core/           framework-free: api client, session store (IndexedDB), turn state machine, recorder
      ui/             React components and screens
  docs/               this document and the implementation plan
  .github/workflows/  ci.yml (build + test both parts), deploy.yml (Fly)
  fly.toml
```

Principles:
- The backend is stateless and has no database. The frontend owns session history and sends the recent turns with each translation request.
- `frontend/src/core` imports nothing from React so it can move into an Expo or Capacitor app later.
- No provider adapter layer. One concrete client per stage. Model switching is configuration only.

## 4. Backend API

All endpoints are under `/api`, require `Authorization: Bearer <APP_TOKEN>`, and return JSON errors as `{"error":{"code":"...","message":"..."}}`. Unauthorised requests get 401. Provider calls time out after `PROVIDER_TIMEOUT_SECONDS` (default 30) and surface as 502 with code `provider_error`.

### GET /api/languages
Returns the supported list: `[{ "code": "ko", "name": "Korean", "nativeName": "한국어" }, ...]`. The voice is not exposed.

### POST /api/transcribe
Multipart form:
- `audio` — the clip (webm/opus from Chrome, mp4/aac from iOS Safari; max `MAX_UPLOAD_MB`, default 25)
- `languages` — the two session language codes, comma separated
- `hint` — optional existing text for the Add more case

Response: `{ "text": "...", "model": "whisper-large-v3-turbo", "latencyMs": 812 }`

The recogniser prompt is built from the language names and the hint, e.g. "The speaker uses Korean or Russian. <hint>".

### POST /api/translate
```json
{
  "languages": ["ru", "ko"],
  "text": "Где здесь ближайшая аптека?",
  "history": [
    { "sourceLang": "ko", "source": "...", "targetLang": "ru", "translation": "..." }
  ]
}
```
Response:
```json
{ "detectedLang": "ru", "targetLang": "ko", "translation": "...", "confident": true,
  "model": "openai/gpt-6-luna", "latencyMs": 640, "usage": { "input": 310, "output": 24 } }
```
Rules: history is truncated to the last `TRANSLATE_CONTEXT_TURNS` (default 10). The model is asked for structured JSON with `detectedLang` constrained to the two session codes or `"other"`. If `"other"`, the backend translates into `languages[1]` and returns `confident: false`. On error or timeout with the primary model, the request is retried once with `TRANSLATE_FALLBACK_MODEL`.

System prompt (summary): you are interpreting a live spoken conversation between two people; the text is in one of the two named languages; reply only with the translation into the other language; keep names, numbers, register and tone; no explanations.

### POST /api/speak
`{ "text": "...", "lang": "ko" }` → `audio/mpeg` body. Voice chosen from the language table (Cartesia `POST /tts/bytes`, model `TTS_MODEL`, mp3 44.1 kHz 64 kbps). A language without a server voice (Cantonese) answers 422 with code `no_voice`; the client then uses the browser's `speechSynthesis`. Text is capped at 1000 characters per call.

## 5. Frontend

- React 19, TypeScript, Vite, `vite-plugin-pwa` for installability and the manifest. Mobile-first layout; works on desktop.
- Recorder: `MediaRecorder` with the browser's default mime type; level meter via `AnalyserNode`; 2-minute cap.
- Turn state machine (in `core`): `idle → recording → transcribing → review → translating → speaking → done`, with `review → recording(append) → transcribing(append) → review`, and `failed(stage)` states with retry. All provider calls go through one `api.ts` client.
- Storage: IndexedDB via `idb`. Text only. Entities:
  - `Session { id, createdAt, languages: [code, code] }`
  - `Turn { id, sessionId, createdAt, sourceText, detectedLang, targetLang, translation, confident, status, error, models: { stt, translate } }`
  - `Prefs { token, usedLanguages: code[] }`
- iOS Safari: audio playback is unlocked inside the Send tap handler; the mp3 is played on the same `<audio>` element when it arrives. If the user leaves the screen first, playback is skipped and replay remains.
- Browser `speechSynthesis` is used only when the speak request fails.

## 6. Providers and configuration

Everything is an environment variable. Local development reads `~/.config/pocket-tolk/.env` (outside the repo). Production uses Fly secrets with the same names. The repo ships `.env.example`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | listen port |
| `APP_TOKEN` | required | shared bearer token |
| `ALLOWED_ORIGIN` | required | frontend origin for CORS |
| `PROVIDER_TIMEOUT_SECONDS` | `30` | per provider call |
| `MAX_UPLOAD_MB` | `25` | clip size cap |
| `STT_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-shaped transcription API |
| `STT_API_KEY` | required | |
| `STT_MODEL` | `whisper-large-v3-turbo` | swap: `https://api.openai.com/v1` + `gpt-transcribe` |
| `TRANSLATE_BASE_URL` | `https://openrouter.ai/api/v1` | |
| `TRANSLATE_API_KEY` | required | |
| `TRANSLATE_MODEL` | `openai/gpt-6-luna` | reasoning effort set to minimal |
| `TRANSLATE_FALLBACK_MODEL` | `anthropic/claude-haiku-5.5` | used after error or timeout |
| `TRANSLATE_CONTEXT_TURNS` | `10` | history sent to the model |
| `TRANSLATE_REASONING_EFFORT` | `minimal` | OpenRouter `reasoning.effort`; `none` measured 1.6–1.8 s steady on GPT-6 Luna vs occasional 7 s with `minimal` |
| `TTS_BASE_URL` | `https://api.cartesia.ai` | Cartesia API |
| `TTS_API_KEY` | required | Cartesia key (`sk_car_…`) |
| `TTS_MODEL` | `sonic-3.6` | Cartesia Sonic model id |

Provider notes (prices as fetched 2026-10-26):
- Speech-to-text: Groq `whisper-large-v3-turbo`, $0.00067/min, OpenAI request shape. OpenAI `gpt-transcribe`, $0.0045/min, same shape. OpenAI's `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` retire 2027-02-26 and must not be used.
- Translation: OpenRouter `openai/gpt-6-luna`, $0.10/$0.50 per 1M tokens; `anthropic/claude-haiku-5.5` same price. Structured output via `response_format` JSON schema.
- Text-to-speech (changed 2026-10-29): Cartesia Sonic 3.6 via `POST /tts/bytes`, header `Cartesia-Version: 2026-08-14`, mp3 output. Free plan: 20,000 characters per month, no card, personal use only, 2 concurrent requests; Pro $5/month for 100,000 characters and a commercial licence. Measured 2.0–2.3 s per call for 4–6 s of audio (non-streaming endpoint). Google Cloud TTS was dropped because its free tier still requires a billing account with a card. OpenAI `gpt-4o-mini-tts` and `tts-1` retire 2027-01-06 and must not be used.

Logging: one structured JSON line per provider call to stdout with stage, model, latency, token usage, and status. No request bodies, no audio, no keys.

## 7. Hosting and CI

- Backend: Fly.io, one `shared-cpu-1x` 256 MB machine, `auto_stop_machines = "stop"`, `min_machines_running = 0`, free `*.fly.dev` HTTPS hostname. Estimated well under $1/month at personal usage.
- Frontend: Cloudflare Pages, free, built from `frontend/` on push to `main`. The API base URL is a build-time variable.
- No custom domain in v1.
- GitHub Actions: `ci.yml` runs `go vet`, `go test`, `npm ci`, `npm run build`, `npm test` on every push and pull request. `deploy.yml` runs `flyctl deploy --remote-only` on push to `main` using a `FLY_API_TOKEN` secret.

## 8. Security

- Keys exist only on the backend. The browser holds only `APP_TOKEN`.
- `APP_TOKEN` comparison uses constant-time equality. Future accounts replace the constant principal in the auth middleware; handlers do not change.
- CORS allows exactly `ALLOWED_ORIGIN`. Upload size and request body size are capped. Provider calls have timeouts.
- The repository is public: `.env*` and `*.json` credentials are gitignored; `.env.example` documents every variable with placeholder values.

## 9. Supported languages and voices

The backend table is the single source of truth. Codes are BCP 47. Voices were picked 2026-10-29 from Cartesia's public library (1050 voices): one masculine conversational voice per language, matched by country for regional variants.

| Code | Language | Cartesia voice | Voice id |
|---|---|---|---|
| en | English | Parker | `30894953-bcce-41fe-892c-15ce19c843ff` |
| ko | Korean | Taehyun | `e1717dc3-b87b-4720-aa7f-b6db290e0609` |
| ru | Russian | Sergei | `1e4176b1-3db9-44d6-a601-4fe68b041942` |
| uk | Ukrainian | Oleh | `05ffab9c-d380-4909-8375-cd12f59238c3` |
| es-ES | Spanish (Spain) | Benito | `02aeee94-c02b-456e-be7a-659672acf82d` |
| es-419 | Spanish (Latin America) | Mateo | `2fc4f1ec-bfd0-46f1-8e6d-d4279eaaf838` |
| fr | French | Mathis | `996ec149-0dca-4389-ad08-e2d6f906b4bf` |
| de | German | Jonas | `dff81230-ff75-49a4-af44-f6b2f43500d8` |
| it | Italian | Marco | `79693aee-1207-4771-a01e-20c393c89e6f` |
| pt-BR | Portuguese (Brazil) | Felipe | `616c64d7-f541-436b-9b8d-e79cfbe19ef9` |
| pt-PT | Portuguese (Portugal) | Gaspar | `e6b8bb73-2655-433d-8a10-7b8cf559d03b` |
| ja | Japanese | Takashi | `b8e1169c-f16a-4064-a6e0-95054169e553` |
| zh-Hans | Chinese (Mandarin, Simplified) | Liu | `653b9445-ae0c-4312-a3ce-375504cff31e` |
| zh-Hant | Chinese (Taiwan) | Feng | `453c418c-125e-4e5a-b048-03fec55d0963` |
| yue | Cantonese | — (Sonic has no Cantonese; browser voice) | — |
| vi | Vietnamese | Minh | `0e58d60a-2f1a-4252-81bd-3db6af45fb41` |
| th | Thai | Somchai | `5de076e9-7b28-4442-b279-e7d80d573505` |
| hi | Hindi | Dev | `910fb75e-1d20-4840-ac63-ac6b26a71bdc` |
| ar | Arabic | Raed | `f9f9f472-6247-4403-9abe-616f7c407c63` |
| he | Hebrew | Gil | `84b969ad-19c7-428d-b742-48d387f7f138` |
| tr | Turkish | Taylan | `c1cfee3d-532d-47f8-8dd2-8e5b2b66bf1d` |
| pl | Polish | Marcin | `d358377a-cd1d-45c5-abd0-701314e36cbe` |
| cs | Czech | Jan | `82db1f84-5b96-4364-b04a-4c7ff80e2f8a` |
| nl | Dutch | Stijn | `da743a82-ddf2-4d9b-8eb8-ff67ca0b138e` |
| sv | Swedish | Nils | `8c889eba-5b31-4179-8fb2-37bbee22db64` |
| nb | Norwegian | Lars | `d6dca1b6-cdd8-4e9c-823c-e03979261740` |
| da | Danish | Søren | `a466f9e2-28eb-4bb7-925c-8e8984950700` |
| fi | Finnish | Matti | `7849a11e-4107-44ae-bc7e-77bea41ec019` |
| el | Greek | Nikos | `b45eba5b-2215-4da7-9c7c-121c95ed7b81` |
| hu | Hungarian | Bence | `4c5c7be8-6b3b-4c62-b915-c54d049c198f` |
| ro | Romanian | Andrei | `3f64ef99-d87b-4b51-b217-df7351f7886a` |
| id | Indonesian | Galang | `04b567df-2923-4b0c-896b-4b7df0a07e1a` |
| ms | Malay | Faiz | `8281db18-6ac5-47bb-91a8-ce23a1f1d951` |
| fil | Filipino | Jerome | `42332792-6e9f-4b2c-a106-3ff97e34a79d` |

Samples for Korean (Taehyun, Haeun) and Russian (Sergei, Tatiana) generated with Sonic 3.6 are saved in `~/dev/interpreter-tts-samples/cartesia-*.mp3` (not in the repo), next to Google's earlier samples.

## 10. Testing

Kept lean on purpose.
- Backend: handler tests with fake provider HTTP servers for transcribe, translate (including fallback and `"other"` detection), speak, and the auth middleware. `go vet` in CI.
- Frontend: unit tests for the turn state machine (append path, failure and retry) and the API client's error mapping. No end-to-end browser tests.

## 11. Decisions log

| Decision | Choice | Rejected |
|---|---|---|
| Platform | web PWA first | native mobile now |
| Backend | Go, standard library | Fiber (fasthttp, no HTTP/2, smaller ecosystem) |
| Frontend | React + Vite | Nuxt, Expo-first |
| Record UX | one button, LLM detects language | two buttons per language |
| Transcription | batch after stop | streaming partials (deferred) |
| Model switching | env vars only | in-app settings, adapter layer |
| STT default | Groq whisper-large-v3-turbo | OpenAI (retiring ids), Deepgram (extra integration) |
| Translation | OpenRouter GPT-6 Luna + Haiku fallback | single model |
| TTS | Cartesia Sonic 3.6, free plan (2026-10-29) | Google Cloud WaveNet (billing account needs a card), OpenAI (retiring), ElevenLabs (10 min/month free), Gemini TTS (free-tier limits unknown, training use) |
| STT vendor | keep Groq | Cartesia Ink (current model lacks ko/ru; batch endpoint needs the language up front, no hint) |
| Hosting | Fly.io (card added 2026-10-29) + Cloudflare Pages | Railway (declined), Render free (sleeps, slow wake) |
| Persistence | IndexedDB, text only | server database |
| Health checks | none in v1 | startup probes |
| Languages | 34 fixed, pinned after use | pinned defaults on first launch |

## 12. Risks and later work

- Whisper turbo accuracy on short Korean phrases is unverified; the swap to OpenAI `gpt-transcribe` is three env vars.
- OpenAI audio deprecations in early 2027 do not affect the defaults.
- Cartesia free plan: 20,000 characters/month and personal use only. Sharing the app with others means Pro ($5/month). When the quota is exhausted the speak call fails and the browser voice takes over.
- Cartesia's bytes endpoint returns the whole clip after ~2 s; streaming playback (SSE or WebSocket into MediaSource) is later work if that feels slow.
- Cantonese has no Cartesia voice; it uses the phone's built-in voice.
- Later: user accounts (auth middleware already isolates this), two-device sessions, streaming transcription for the live preview, Expo or Capacitor shell, offline evaluation script for model comparison.
