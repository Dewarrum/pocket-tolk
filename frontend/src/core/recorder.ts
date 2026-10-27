// Microphone recording with a level meter and a length cap. Framework-free.

export const MAX_CLIP_MS = 2 * 60 * 1000

export interface Clip {
  blob: Blob
  mimeType: string
  durationMs: number
}

export interface Recording {
  /** Current input level from 0 (silence) to 1 (loud speech). */
  level(): number
  elapsedMs(): number
  /** Stops and resolves with the clip. Calling it again returns the same clip. */
  stop(): Promise<Clip>
  /** Stops and throws the audio away. */
  cancel(): void
}

export interface RecordOptions {
  maxMs?: number
  /** Called with the clip when it reaches maxMs and stops by itself. */
  onLimit?: (clip: Clip) => void
}

export type RecorderErrorCode = 'unsupported' | 'denied' | 'no_microphone' | 'failed'

export class RecorderError extends Error {
  readonly code: RecorderErrorCode

  constructor(code: RecorderErrorCode, message: string) {
    super(message)
    this.name = 'RecorderError'
    this.code = code
  }
}

export function isRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** Must be called from a user gesture (Safari only starts audio inside one). */
export async function startRecording({ maxMs = MAX_CLIP_MS, onLimit }: RecordOptions = {}): Promise<Recording> {
  if (!isRecordingSupported()) {
    throw new RecorderError('unsupported', 'This browser cannot record audio here. Recording needs HTTPS.')
  }

  // Created before the first await so it stays tied to the gesture.
  const audio = new AudioContext()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch (err) {
    void audio.close()
    throw toRecorderError(err)
  }
  void audio.resume()

  const analyser = audio.createAnalyser()
  analyser.fftSize = 1024
  audio.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)

  // No mimeType option: each browser uses its default (webm/opus in Chrome, mp4/aac in Safari).
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  })
  const stopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }))

  const startedAt = performance.now()
  let endedAt: number | null = null
  let clip: Promise<Clip> | null = null
  let limitTimer: ReturnType<typeof setTimeout> | undefined

  const release = () => {
    clearTimeout(limitTimer)
    stream.getTracks().forEach((t) => t.stop())
    if (audio.state !== 'closed') void audio.close()
  }

  const stop = (): Promise<Clip> => {
    if (!clip) {
      endedAt = performance.now()
      if (recorder.state !== 'inactive') recorder.stop()
      clip = stopped.then(() => {
        release()
        const mimeType = recorder.mimeType || chunks[0]?.type || ''
        return {
          blob: new Blob(chunks, { type: mimeType }),
          mimeType,
          durationMs: Math.min(endedAt! - startedAt, maxMs),
        }
      })
    }
    return clip
  }

  recorder.start()
  limitTimer = setTimeout(() => void stop().then((c) => onLimit?.(c)), maxMs)

  return {
    level() {
      if (endedAt !== null) return 0
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const s of samples) sum += s * s
      const db = 20 * Math.log10(Math.sqrt(sum / samples.length) || 1e-8)
      // -60 dB is silence, -10 dB is loud speech close to the phone.
      return Math.min(1, Math.max(0, (db + 60) / 50))
    },
    elapsedMs: () => Math.min((endedAt ?? performance.now()) - startedAt, maxMs),
    stop,
    cancel() {
      endedAt ??= performance.now()
      clip ??= Promise.reject(new RecorderError('failed', 'The recording was cancelled.'))
      clip.catch(() => {})
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}

function toRecorderError(err: unknown): RecorderError {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new RecorderError('denied', 'Microphone access is blocked. Allow it in the browser settings.')
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new RecorderError('no_microphone', 'No microphone was found.')
  }
  return new RecorderError('failed', 'The microphone could not be started.')
}
