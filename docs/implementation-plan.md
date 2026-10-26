# Pocket Tolk — Implementation plan

Companion to `design.md`. Three slices, each ending in something you can use on your phone. Each slice lists prerequisites you provide, the work, and how it is verified.

## Prerequisites checklist

| Item | Needed by | Status 2026-10-26 |
|---|---|---|
| Go toolchain | slice 1 | done (go 1.27.3) |
| Node 24 | slice 1 | done |
| GitHub CLI logged in as Dewarrum | slice 1 | done |
| Groq key in `~/.config/pocket-tolk/.env` | slice 1 | done |
| OpenRouter key as `TRANSLATE_API_KEY` in the same file | slice 2 | pending |
| Google Cloud project, Text-to-Speech API enabled, service account JSON at `~/.config/pocket-tolk/google-sa.json` | slice 3 | pending |
| Fly.io account and `flyctl` installed | slice 3 | pending |
| Cloudflare account | slice 3 | pending |

## Slice 1 — Record and transcribe

Goal: press the button on the phone, speak, see editable text, use Record again and Add more.

Backend
1. Create the GitHub repo `Dewarrum/pocket-tolk` (public), push the scaffold with `.gitignore`, `.env.example`, `docs/`.
2. `internal/config`: load env, apply defaults, fail fast on missing required values. Local dev loads `~/.config/pocket-tolk/.env` through a small `dev.sh`.
3. `internal/httpapi`: router, JSON error envelope, request logging, body size limit, CORS for `ALLOWED_ORIGIN`, bearer auth middleware with constant-time compare and a `Principal` type in the request context.
4. `internal/languages`: the 34-entry table and `GET /api/languages`.
5. `internal/stt`: OpenAI-shaped multipart client (`/audio/transcriptions`), prompt built from language names and hint, `POST /api/transcribe`.
6. Tests: auth middleware, languages handler, transcribe handler against a fake STT server (success, provider error, oversize upload).
7. `Dockerfile` (multi-stage, distroless) and `fly.toml` drafted but not deployed yet.

Frontend
8. Vite + React + TypeScript scaffold, `vite-plugin-pwa`, mobile-first base layout, token entry screen storing `APP_TOKEN` locally.
9. `core/recorder.ts`: `MediaRecorder` wrapper, level meter, 2-minute cap, returns a Blob with its mime type.
10. `core/api.ts`: typed client for the four endpoints with the error envelope.
11. `core/turnMachine.ts`: the state machine from the design, pure functions, no React.
12. UI: new-session screen with two pickers from `/api/languages`; session screen with record button, timer, meter, editable review field, Send (disabled in this slice), Record again, Add more.
13. Tests: turn machine transitions including append and transcription failure.

CI
14. `.github/workflows/ci.yml`: Go vet and test, frontend install, build, and test.

Verification
- Laptop: `dev.sh` runs the backend on :8080 and Vite on :5173 with a proxy; record in Chrome, see the transcript, append a second clip.
- Phone: not yet, HTTPS is needed; comes with slice 3. Optional early path: `flyctl deploy` by hand after slice 1 if you want phone testing sooner.

## Slice 2 — Translate and remember

Goal: Send produces a translation shown in the turn list; sessions persist and reopen.

Backend
1. `internal/translate`: OpenRouter chat client with `response_format` JSON schema, system prompt from the design, history truncation, `reasoning.effort = "minimal"`, fallback model on error or timeout, usage and latency in the response and logs.
2. `POST /api/translate` with validation (codes must be in the supported table, text non-empty).
3. Tests against a fake OpenRouter server: normal detection, `"other"` detection, primary failure then fallback, timeout.

Frontend
4. `core/store.ts`: IndexedDB via `idb` for sessions, turns, prefs.
5. Home screen: session list, new, delete (long-press or swipe).
6. Language pickers: pin used languages at the top, persisted in prefs.
7. Send wired to translate; turn list rendering with detected language, translation, unconfident warning, failure and Retry.
8. Tests: machine transitions for translating and retry.

Verification
- Laptop: a Russian–Korean session with several turns in both directions; context visible in the translations; reload and reopen the session.

## Slice 3 — Speak and deploy

Goal: the translation is spoken on the phone over HTTPS, deployed from `main`.

Backend
1. `internal/tts`: Google Cloud Text-to-Speech client, credentials from JSON string or path, voice from the table, mp3 output, `POST /api/speak`.
2. Tests: speak handler with a fake TTS client, unknown language rejected.
3. Fly: `flyctl launch` with the drafted `fly.toml`, secrets set, auto-stop verified.

Frontend
4. Autoplay after Send with the iOS unlock pattern, replay button, `speechSynthesis` fallback when the request fails.
5. Build-time API base URL; Cloudflare Pages project connected to the repo, `ALLOWED_ORIGIN` set to the Pages URL on Fly.

CI
6. `.github/workflows/deploy.yml`: Fly deploy on push to `main` with `FLY_API_TOKEN`.

Verification
- iPhone Safari: install the PWA, run a real Russian–Korean and English–Korean exchange, confirm playback starts without an extra tap, confirm Retry on a forced failure (wrong key), check Fly logs for the per-call lines.

## After v1 (not scheduled)

- Model comparison: read latency and usage from Fly logs; add an offline evaluation script if needed.
- Accounts: replace the constant principal in the auth middleware; add a database for sessions.
- Streaming transcription for a live preview while speaking.
- Expo or Capacitor shell reusing `frontend/src/core`.
