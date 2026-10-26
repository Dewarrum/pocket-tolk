import { useCallback, useEffect, useRef, useState } from 'react'
import { startRecording, type Clip, type Recording } from '@/core/recorder'

const BARS = 32
const SAMPLE_MS = 70

export interface Meter {
  elapsedMs: number
  /** Recent input levels, oldest first, each 0 to 1. */
  levels: number[]
}

const silent: Meter = { elapsedMs: 0, levels: Array(BARS).fill(0) }

/** Wraps core/recorder for React: one live recording and its meter. */
export function useRecorder() {
  const handle = useRef<Recording | null>(null)
  const [live, setLive] = useState(false)
  const [meter, setMeter] = useState<Meter>(silent)

  useEffect(() => {
    if (!live) return
    let frame = 0
    let last = 0
    const tick = (now: number) => {
      const rec = handle.current
      if (rec && now - last >= SAMPLE_MS) {
        last = now
        setMeter((m) => ({ elapsedMs: rec.elapsedMs(), levels: [...m.levels.slice(1), rec.level()] }))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [live])

  useEffect(() => () => handle.current?.cancel(), [])

  /** Call from the tap handler itself: Safari needs the gesture. */
  const start = useCallback(async (onLimit: (clip: Clip) => void) => {
    const rec = await startRecording({
      onLimit: (clip) => {
        handle.current = null
        setLive(false)
        onLimit(clip)
      },
    })
    handle.current = rec
    setMeter(silent)
    setLive(true)
  }, [])

  const stop = useCallback(async (): Promise<Clip | null> => {
    const rec = handle.current
    if (!rec) return null
    handle.current = null
    setLive(false)
    return rec.stop()
  }, [])

  const cancel = useCallback(() => {
    handle.current?.cancel()
    handle.current = null
    setLive(false)
  }, [])

  return { start, stop, cancel, live, meter }
}
