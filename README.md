# Pocket Tolk

A personal, mobile-first web app that interprets a face-to-face conversation on one shared phone. Each person presses the same button, speaks their own language, checks the recognised text, and sends it for translation and speech.

Status: v1 (slice 3 of 3, speak and deploy). Translations are spoken aloud with a Cartesia voice (the phone's own voice when that fails), conversations are kept on the device, and the app runs at https://pocket-tolk.pages.dev with the backend on https://pocket-tolk.fly.dev. See [docs/design.md](docs/design.md), [docs/implementation-plan.md](docs/implementation-plan.md) and [docs/design-system.md](docs/design-system.md).

## Layout

```
backend/    Go service (standard library HTTP): /api/languages, /api/transcribe, /api/translate, /api/speak
frontend/   React + TypeScript + Vite PWA; src/core has no React imports
docs/       design, plan, design system
dev.sh      runs both for local development
fly.toml    Fly.io app for the backend
.github/    ci.yml (vet, test, build) and deploy.yml (Fly and Pages on push to main)
```

## Run locally

Prerequisites: Go 1.27, Node 24, a Groq API key, an OpenRouter API key, a Cartesia API key.

1. Put the provider settings outside the repo, in `~/.config/pocket-tolk/.env` (see [.env.example](.env.example) for every variable):

   ```
   STT_API_KEY=gsk_...
   TRANSLATE_API_KEY=sk-or-...
   TTS_API_KEY=sk_car_...
   ```

2. Start both parts:

   ```sh
   ./dev.sh            # backend on :8080, Vite on http://localhost:5173 (proxies /api)
   ./dev.sh backend    # backend only
   PORT=8081 ./dev.sh  # if :8080 is taken; the Vite proxy follows PORT
   ```

   `dev.sh` defaults `APP_TOKEN` to `dev-token` and `ALLOWED_ORIGIN` to `http://localhost:5173`. Values already in your environment win over the file.

3. Open http://localhost:5173, enter `dev-token` as the server password, start a conversation, pick two languages, and record. Conversations are kept in the browser's IndexedDB (text only, never audio).

Recording needs a secure context: `localhost` works on the laptop, but a phone on the LAN over plain HTTP cannot use the microphone. Test on the phone through the deployed app (below).

Try the API directly:

```sh
curl -H 'Authorization: Bearer dev-token' http://localhost:8080/api/languages
curl -H 'Authorization: Bearer dev-token' \
  -F audio=@clip.wav -F languages=ko,ru http://localhost:8080/api/transcribe
curl -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' \
  -d '{"languages":["ru","ko"],"text":"Где здесь аптека?","history":[]}' http://localhost:8080/api/translate
curl -H 'Authorization: Bearer dev-token' -H 'Content-Type: application/json' -o speech.mp3 \
  -d '{"lang":"ko","text":"약국은 모퉁이를 돌면 바로 있어요."}' http://localhost:8080/api/speak
```

## Test and build

```sh
cd backend && go vet ./... && go test ./...
cd frontend && npm ci && npm test && npm run build
```

CI runs the same on every push and pull request (`.github/workflows/ci.yml`).

## Configuration

Every setting is an environment variable; production uses Fly secrets with the same names. The backend reads `PORT`, `APP_TOKEN` (the server password the app asks for), `ALLOWED_ORIGIN`, `PROVIDER_TIMEOUT_SECONDS`, `MAX_UPLOAD_MB`, `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`, `TRANSLATE_BASE_URL`, `TRANSLATE_API_KEY`, `TRANSLATE_MODEL`, `TRANSLATE_FALLBACK_MODEL`, `TRANSLATE_CONTEXT_TURNS`, `TRANSLATE_REASONING_EFFORT`, `TTS_BASE_URL`, `TTS_API_KEY` and `TTS_MODEL`; it refuses to start and lists what is missing when a required one is absent. Each provider call logs one JSON line with its stage, model, latency, status and, per stage, token usage and whether the fallback answered (translate), or characters in and bytes out (tts). The frontend reads `VITE_API_BASE_URL` at build time (empty means same origin, which keeps the Vite proxy in development).

## Deploy

Pushes to `main` deploy both parts (`.github/workflows/deploy.yml`):

- **Backend → Fly.io** app `pocket-tolk` (region `nrt`, one `shared-cpu-1x` 256 MB machine that stops when idle and starts on the next request in about a second): `flyctl deploy --remote-only` with the repository secret `FLY_API_TOKEN` (a deploy token, `flyctl tokens create deploy -a pocket-tolk -x 8760h`). Settings are Fly secrets with the names above. To change provider keys after editing the local env file, without showing them:

  ```sh
  grep -E '^(STT|TRANSLATE|TTS)_[A-Z_]+=' ~/.config/pocket-tolk/.env | flyctl secrets import -a pocket-tolk
  ```

  `APP_TOKEN` is kept in `~/.config/pocket-tolk/app-token.txt` (mode 600); `ALLOWED_ORIGIN` is `https://pocket-tolk.pages.dev`. Logs: `flyctl logs -a pocket-tolk`.
- **Frontend → Cloudflare Pages** project `pocket-tolk`, built with `VITE_API_BASE_URL=https://pocket-tolk.fly.dev`. CI deploys it only when the repository secret `CLOUDFLARE_API_TOKEN` exists (a Cloudflare API token from the "Edit Cloudflare Workers" template, which includes Pages); the account id is the repository variable `CLOUDFLARE_ACCOUNT_ID`. **The owner has to add that secret** (`gh secret set CLOUDFLARE_API_TOKEN`); until then the frontend job is skipped and Pages is deployed from the laptop, where `wrangler` is logged in:

  ```sh
  cd frontend
  VITE_API_BASE_URL=https://pocket-tolk.fly.dev npm run build
  npx wrangler pages deploy dist --project-name pocket-tolk --branch main
  ```

## Install on iPhone

1. Open https://pocket-tolk.pages.dev in Safari.
2. Tap Share, then **Add to Home Screen**, then Add. Pocket Tolk opens from the home screen as a full-screen app.
3. Enter the server password: the contents of `~/.config/pocket-tolk/app-token.txt` on the laptop. The app keeps it on the phone; the provider keys stay on the server.
4. Allow the microphone when asked. If the phone's own voice should cover a language the server cannot speak (Cantonese), download it under Settings → Accessibility → Spoken Content → Voices.
