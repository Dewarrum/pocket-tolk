import { createApiClient, type Language } from '@/core/api'
import { createSpeaker } from '@/core/speaker'
import { createStore } from '@/core/store'

const TOKEN_KEY = 'pocket-tolk.token'

/** The server password, kept in localStorage so the API client can read it synchronously. */
export const tokenStore = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

/** Empty in development: Vite proxies /api to the backend. */
export const apiBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? ''

export const api = createApiClient({ baseUrl: apiBaseUrl, getToken: tokenStore.get })

export const store = createStore()

/** One audio element for the whole app run: once a tap has unlocked it, iOS lets it play later. */
export const speaker = createSpeaker()

let languageTable: Promise<Language[]> | null = null

/** The supported languages, fetched once per app run; a failure is retried on the next call. */
export function loadLanguages(): Promise<Language[]> {
  languageTable ??= api.languages().catch((err: unknown) => {
    languageTable = null
    throw err
  })
  return languageTable
}

/**
 * The language for a stored code. Falls back to the browser's own names, so
 * saved conversations still read well before the table loads or offline.
 */
export function languageFor(code: string, table: readonly Language[] | null): Language {
  const known = table?.find((l) => l.code === code)
  if (known) return known
  const name = (locale: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
    } catch {
      return code
    }
  }
  return { code, name: name('en'), nativeName: name(code) }
}
