# Pocket Tolk

A personal, mobile-first web app that interprets a face-to-face conversation on one shared phone. Each person presses the same button, speaks their own language, checks the recognised text, and sends it for translation and speech.

Status: slice 1 of 3 (record and transcribe). Translation, speech, saved sessions and deployment come in slices 2 and 3. See [docs/design.md](docs/design.md), [docs/implementation-plan.md](docs/implementation-plan.md) and [docs/design-system.md](docs/design-system.md).

## Layout

```
backend/    Go service (standard library HTTP): /api/languages, /api/transcribe
frontend/   React + TypeScript + Vite PWA; src/core has no React imports
docs/       design, plan, design system
dev.sh      runs both for local development
fly.toml    Fly.io app (drafted, not deployed yet)
```

## Run locally

Prerequisites: Go 1.27, Node 24, a Groq API key.

1. Put the provider settings outside the repo, in `~/.config/pocket-tolk/.env` (see [.env.example](.env.example) for every variable):

   ```
   STT_API_KEY=gsk_...
   ```

2. Start both parts:

   ```sh
   ./dev.sh            # backend on :8080, Vite on http://localhost:5173 (proxies /api)
   ./dev.sh backend    # backend only
   PORT=8081 ./dev.sh  # if :8080 is taken; the Vite proxy follows PORT
   ```

   `dev.sh` defaults `APP_TOKEN` to `dev-token` and `ALLOWED_ORIGIN` to `http://localhost:5173`. Values already in your environment win over the file.

3. Open http://localhost:5173, enter `dev-token`, pick two languages, and record.

Recording needs a secure context: `localhost` works on the laptop, but a phone on the LAN over plain HTTP cannot use the microphone. Phone testing comes with the HTTPS deployment in slice 3. Use the browser's device emulation for phone layouts meanwhile.

Try the API directly:

```sh
curl -H 'Authorization: Bearer dev-token' http://localhost:8080/api/languages
curl -H 'Authorization: Bearer dev-token' \
  -F audio=@clip.wav -F languages=ko,ru http://localhost:8080/api/transcribe
```

## Test and build

```sh
cd backend && go vet ./... && go test ./...
cd frontend && npm ci && npm test && npm run build
```

CI runs the same on every push and pull request (`.github/workflows/ci.yml`).

## Configuration

Every setting is an environment variable; production uses Fly secrets with the same names. Slice 1 reads `PORT`, `APP_TOKEN`, `ALLOWED_ORIGIN`, `PROVIDER_TIMEOUT_SECONDS`, `MAX_UPLOAD_MB`, `STT_BASE_URL`, `STT_API_KEY` and `STT_MODEL`; the backend refuses to start and lists what is missing when a required one is absent. The frontend reads `VITE_API_BASE_URL` at build time (empty means same origin).
