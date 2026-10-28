# Pocket Tolk

A personal, mobile-first web app that interprets a face-to-face conversation on one shared phone. Each person presses the same button, speaks their own language, checks the recognised text, and sends it for translation and speech.

Status: slice 2 of 3 (translate and remember). Conversations are translated with the recent turns as context and kept on the device; speech and deployment come in slice 3. See [docs/design.md](docs/design.md), [docs/implementation-plan.md](docs/implementation-plan.md) and [docs/design-system.md](docs/design-system.md).

## Layout

```
backend/    Go service (standard library HTTP): /api/languages, /api/transcribe, /api/translate
frontend/   React + TypeScript + Vite PWA; src/core has no React imports
docs/       design, plan, design system
dev.sh      runs both for local development
fly.toml    Fly.io app (drafted, not deployed yet)
```

## Run locally

Prerequisites: Go 1.27, Node 24, a Groq API key, an OpenRouter API key.

1. Put the provider settings outside the repo, in `~/.config/pocket-tolk/.env` (see [.env.example](.env.example) for every variable):

   ```
   STT_API_KEY=gsk_...
   TRANSLATE_API_KEY=sk-or-...
   ```

2. Start both parts:

   ```sh
   ./dev.sh            # backend on :8080, Vite on http://localhost:5173 (proxies /api)
   ./dev.sh backend    # backend only
   PORT=8081 ./dev.sh  # if :8080 is taken; the Vite proxy follows PORT
   ```

   `dev.sh` defaults `APP_TOKEN` to `dev-token` and `ALLOWED_ORIGIN` to `http://localhost:5173`. Values already in your environment win over the file.

3. Open http://localhost:5173, enter `dev-token` as the server password, start a conversation, pick two languages, and record. Conversations are kept in the browser's IndexedDB (text only, never audio).

Recording needs a secure context: `localhost` works on the laptop, but a phone on the LAN over plain HTTP cannot use the microphone. Phone testing comes with the HTTPS deployment in slice 3. Use the browser's device emulation for phone layouts meanwhile.

Try the API directly:

```sh
curl -H 'Authorization: Bearer dev-token' http://localhost:8080/api/languages
curl -H 'Authorization: Bearer dev-token' \
  -F audio=@clip.wav -F languages=ko,ru http://localhost:8080/api/transcribe
curl -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"languages":["ru","ko"],"text":"Где здесь аптека?","history":[]}' http://localhost:8080/api/translate
```

## Test and build

```sh
cd backend && go vet ./... && go test ./...
cd frontend && npm ci && npm test && npm run build
```

CI runs the same on every push and pull request (`.github/workflows/ci.yml`).

## Configuration

Every setting is an environment variable; production uses Fly secrets with the same names. The backend reads `PORT`, `APP_TOKEN` (the server password the app asks for), `ALLOWED_ORIGIN`, `PROVIDER_TIMEOUT_SECONDS`, `MAX_UPLOAD_MB`, `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`, `TRANSLATE_BASE_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL`, `TRANSLATE_FALLBACK_MODEL` and `TRANSLATE_CONTEXT_TURNS`; it refuses to start and lists what is missing when a required one is absent. Each provider call logs one JSON line with its stage, model, latency, status and (for translation) token usage and whether the fallback answered. The frontend reads `VITE_API_BASE_URL` at build time (empty means same origin).
