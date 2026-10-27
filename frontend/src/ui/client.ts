import { createApiClient } from '@/core/api'

const TOKEN_KEY = 'pocket-tolk.token'

export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

/** Empty in development: Vite proxies /api to the backend. */
export const apiBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? ''

export const api = createApiClient({ baseUrl: apiBaseUrl, getToken: tokenStore.get })
