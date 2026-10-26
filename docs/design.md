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
      languages/      supported-language table with Google voices
      stt/            OpenAI-shaped transcription client
      translate/      OpenRouter chat client, prompt, structured output, fallback
      tts/            Google Cloud Text-to-Speech client
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
`{ "text": "...", "lang": "ko" }` → `audio/mpeg` body. Voice chosen from the language table.

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
| `GOOGLE_TTS_CREDENTIALS_JSON` | required in prod | service account JSON as a string |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional | path alternative for local dev |

Provider notes (prices as fetched 2026-10-26):
- Speech-to-text: Groq `whisper-large-v3-turbo`, $0.00067/min, OpenAI request shape. OpenAI `gpt-transcribe`, $0.0045/min, same shape. OpenAI's `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` retire 2027-02-26 and must not be used.
- Translation: OpenRouter `openai/gpt-6-luna`, $0.10/$0.50 per 1M tokens; `anthropic/claude-haiku-5.5` same price. Structured output via `response_format` JSON schema.
- Text-to-speech: Google Cloud Text-to-Speech, WaveNet/Standard voices at $4 per 1M characters with 4M free per month, mp3 output. OpenAI `gpt-4o-mini-tts` and `tts-1` retire 2027-01-06 and must not be used.

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

The backend table is the single source of truth. Codes are BCP 47. Voices prefer WaveNet and male where Google offers them.

| Code | Language | Google voice |
|---|---|---|
| en | English | en-US-Wavenet-D |
| ko | Korean | ko-KR-Wavenet-C |
| ru | Russian | ru-RU-Wavenet-B |
| uk | Ukrainian | uk-UA-Wavenet-B |
| es-ES | Spanish (Spain) | es-ES-Wavenet-E |
| es-419 | Spanish (Latin America) | es-US-Wavenet-B |
| fr | French | fr-FR-Wavenet-G |
| de | German | de-DE-Wavenet-H |
| it | Italian | it-IT-Wavenet-F |
| pt-BR | Portuguese (Brazil) | pt-BR-Wavenet-B |
| pt-PT | Portuguese (Portugal) | pt-PT-Wavenet-F |
| ja | Japanese | ja-JP-Wavenet-C |
| zh-Hans | Chinese (Mandarin, Simplified) | cmn-CN-Wavenet-B |
| zh-Hant | Chinese (Taiwan) | cmn-TW-Wavenet-B |
| yue | Cantonese | yue-HK-Standard-B |
| vi | Vietnamese | vi-VN-Wavenet-B |
| th | Thai | th-TH-Standard-A |
| hi | Hindi | hi-IN-Wavenet-B |
| ar | Arabic | ar-XA-Wavenet-B |
| he | Hebrew | he-IL-Wavenet-B |
| tr | Turkish | tr-TR-Wavenet-B |
| pl | Polish | pl-PL-Wavenet-G |
| cs | Czech | cs-CZ-Wavenet-B |
| nl | Dutch | nl-NL-Wavenet-G |
| sv | Swedish | sv-SE-Wavenet-C |
| nb | Norwegian | nb-NO-Wavenet-G |
| da | Danish | da-DK-Wavenet-G |
| fi | Finnish | fi-FI-Wavenet-B |
| el | Greek | el-GR-Wavenet-B |
| hu | Hungarian | hu-HU-Wavenet-B |
| ro | Romanian | ro-RO-Wavenet-B |
| id | Indonesian | id-ID-Wavenet-B |
| ms | Malay | ms-MY-Wavenet-B |
| fil | Filipino | fil-PH-Wavenet-C |

Google's published samples for the Korean and Russian voices are saved in `~/dev/interpreter-tts-samples` (not in the repo).

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
| TTS | Google Cloud WaveNet | OpenAI (retiring), ElevenLabs (price) |
| Hosting | Fly.io + Cloudflare Pages | Railway ($5 floor for a custom-domain-capable plan) |
| Persistence | IndexedDB, text only | server database |
| Health checks | none in v1 | startup probes |
| Languages | 34 fixed, pinned after use | pinned defaults on first launch |

## 12. Risks and later work

- Whisper turbo accuracy on short Korean phrases is unverified; the swap to OpenAI `gpt-transcribe` is three env vars.
- OpenAI audio deprecations in early 2027 do not affect the defaults.
- Later: user accounts (auth middleware already isolates this), two-device sessions, streaming transcription for the live preview, Expo or Capacitor shell, offline evaluation script for model comparison.
