/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Backend origin, e.g. https://pocket-tolk.fly.dev. Empty for same origin. */
  readonly VITE_API_BASE_URL?: string
}
