import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/core/api'
import type { Turn } from '@/core/store'
import { api, speaker } from '@/ui/client'

/** A turn last spoken by the phone's own voice, or not spoken because the phone has none. */
export type Fallback = 'device' | 'none'

/**
 * Speaks translated turns, one at a time: a newer request cuts off the one
 * before. Server audio is kept in memory for replay while the screen is open.
 */
export function useSpeech(onUnauthorized: () => void) {
  const cache = useRef(new Map<string, Blob>())
  const job = useRef<AbortController | null>(null)
  const [active, setActive] = useState<{ turnId: string; loading: boolean } | null>(null)
  const [fallbacks, setFallbacks] = useState<Record<string, Fallback>>({})

  /**
   * Speaks the turn's translation with the server voice or the device's.
   * Resolves when it ends or is cut off; rejects when the server voice fails.
   */
  const say = useCallback(async (turn: Turn, via: 'server' | 'device', signal?: AbortSignal) => {
    const mark = (fallback: Fallback | null) =>
      setFallbacks((prev) => {
        const next = { ...prev }
        if (fallback) next[turn.id] = fallback
        else delete next[turn.id]
        return next
      })
    const { translation: text, targetLang: lang } = turn
    if (!text || !lang) return
    job.current?.abort()
    const mine = new AbortController()
    job.current = mine
    signal?.addEventListener('abort', () => mine.abort(), { once: true })
    try {
      if (via === 'server') {
        const key = `${lang}\n${text}`
        let mp3 = cache.current.get(key)
        if (!mp3) {
          setActive({ turnId: turn.id, loading: true })
          mp3 = await api.speak({ text, lang, signal: mine.signal })
          cache.current.set(key, mp3)
        }
        if (mine.signal.aborted) return
        setActive({ turnId: turn.id, loading: false })
        mark(null)
        await speaker.play(mp3, mine.signal)
      } else {
        const voice = await speaker.deviceVoice(lang)
        if (mine.signal.aborted) return
        mark(voice ? 'device' : 'none')
        if (!voice) return
        setActive({ turnId: turn.id, loading: false })
        await speaker.speakOnDevice(text, voice, mine.signal)
      }
    } catch (err) {
      if (!mine.signal.aborted) throw err
    } finally {
      if (job.current === mine) {
        job.current = null
        setActive(null)
      }
    }
  }, [])

  const stop = useCallback(() => {
    job.current?.abort()
    speaker.stop()
  }, [])

  /** Call from the tap handler itself: iOS needs the gesture. */
  const replay = useCallback(
    (turn: Turn) => {
      speaker.unlock()
      say(turn, 'server')
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.code === 'unauthorized') return onUnauthorized()
          return say(turn, 'device')
        })
        .catch(() => {})
    },
    [say, onUnauthorized],
  )

  // Leaving the screen cuts the voice off; replay stays on the turns.
  useEffect(() => stop, [stop])

  return { active, fallbacks, say, replay, stop }
}
