// Typed client for the Pocket Tolk backend. Framework-free.

export interface Language {
  code: string
  name: string
  nativeName: string
}

export interface Transcription {
  text: string
  model: string
  latencyMs: number
}

/** An earlier, translated turn sent as context. */
export interface HistoryEntry {
  /** A session language, or `other`. */
  sourceLang: string
  source: string
  targetLang: string
  translation: string
}

export interface Translation {
  /** A session language, or `other` when the text was in neither. */
  detectedLang: string
  targetLang: string
  translation: string
  /** False when the language was not recognised and the target is a best guess. */
  confident: boolean
  model: string
  latencyMs: number
  usage: { input: number; output: number }
}

export interface TranslateInput {
  languages: readonly [string, string]
  text: string
  /** Oldest first. */
  history: HistoryEntry[]
  signal?: AbortSignal
}

export interface TranscribeInput {
  audio: Blob
  languages: readonly [string, string]
  /** Text the new clip continues (Add more). */
  hint?: string
  signal?: AbortSignal
}

/** Every failed call rejects with an ApiError, except aborts, which rethrow as is. */
export class ApiError extends Error {
  readonly status: number
  /** Backend error code, or `network_error` / `http_error` when there was no envelope. */
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiClientOptions {
  /** Empty means same origin (the Vite proxy in development). */
  baseUrl?: string
  getToken: () => string | null
  fetch?: typeof fetch
}

export function createApiClient({ baseUrl = '', getToken, fetch: fetchImpl }: ApiClientOptions) {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis)

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    let res: Response
    try {
      res = await doFetch(baseUrl + path, { ...init, headers })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ApiError(0, 'network_error', 'The server could not be reached.')
    }
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as T
  }

  return {
    languages(signal?: AbortSignal) {
      return request<Language[]>('/api/languages', { signal })
    },

    transcribe({ audio, languages, hint, signal }: TranscribeInput) {
      const form = new FormData()
      form.append('audio', audio, clipFileName(audio.type))
      form.append('languages', languages.join(','))
      if (hint?.trim()) form.append('hint', hint.trim())
      return request<Transcription>('/api/transcribe', { method: 'POST', body: form, signal })
    },

    translate({ languages, text, history, signal }: TranslateInput) {
      return request<Translation>('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languages, text, history }),
        signal,
      })
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body: unknown = JSON.parse(await res.text())
    const error = (body as { error?: { code?: unknown; message?: unknown } })?.error
    if (typeof error?.code === 'string') {
      const message = typeof error.message === 'string' ? error.message : error.code
      return new ApiError(res.status, error.code, message)
    }
  } catch {
    // Not our envelope (a proxy or platform error page); fall through.
  }
  return new ApiError(res.status, 'http_error', `The server answered with status ${res.status}.`)
}

const extensions: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
}

/** The transcription API infers the container from the file extension. */
export function clipFileName(mimeType: string): string {
  const ext = extensions[mimeType.split(';')[0].trim().toLowerCase()]
  return ext ? `clip.${ext}` : 'clip'
}

/**
 * A sentence for the person holding the phone: what went wrong and what to do.
 * `service` names the provider behind the call, for provider errors.
 */
export function errorMessage(err: unknown, service: 'speech' | 'translation' = 'speech'): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Try again.'
  switch (err.code) {
    case 'unauthorized':
      return 'The server password was not accepted.'
    case 'network_error':
      return 'The server could not be reached. Check the connection and try again.'
    case 'provider_error':
      return `The ${service} service had a problem. Try again in a moment.`
    case 'too_large':
      return 'The recording is too large to send. Record a shorter clip.'
    case 'bad_request':
    case 'unsupported_language':
      return `The server rejected the request: ${err.message}.`
    default:
      return `Something went wrong (${err.status || err.code}). Try again.`
  }
}
