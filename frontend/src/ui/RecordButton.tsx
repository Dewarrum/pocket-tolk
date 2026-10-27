import { Loader2, Mic } from 'lucide-react'
import * as m from 'motion/react-m'
import { useReducedMotion, type Transition } from 'motion/react'
import type { Meter } from '@/ui/useRecorder'
import { cn } from '@/ui/lib/utils'
import { formatElapsed } from '@/ui/voice'

export type RecordMode = 'idle' | 'starting' | 'live' | 'busy'

const labels: Record<RecordMode, string> = {
  idle: 'Start recording',
  starting: 'Starting the microphone',
  live: 'Stop recording',
  busy: 'Transcribing',
}

/**
 * The one bold element: an Ink stadium that grows into a Tally-red live strip
 * holding the stop square, the timer and the level bars.
 */
export function RecordButton({
  mode,
  meter,
  onPress,
  describedBy,
}: {
  mode: RecordMode
  meter: Meter
  onPress: () => void
  describedBy?: string
}) {
  const reduce = useReducedMotion()
  const morph: Transition = reduce ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 34 }
  const wide = mode === 'live' || mode === 'busy'

  return (
    <div className="flex w-full justify-center">
      <m.button
        type="button"
        onClick={onPress}
        disabled={mode === 'busy' || mode === 'starting'}
        aria-label={labels[mode]}
        aria-describedby={describedBy}
        initial={false}
        animate={{ width: wide ? '100%' : '9.5rem' }}
        transition={morph}
        className={cn(
          'flex h-20 touch-manipulation items-center justify-center gap-4 overflow-hidden rounded-full px-6 select-none',
          'transition-colors duration-200 focus-visible:outline-offset-4 motion-reduce:transition-none',
          mode === 'live' ? 'bg-tally text-on-tally' : 'bg-ink text-on-ink',
          mode === 'starting' && 'opacity-70',
        )}
      >
        {mode === 'live' && (
          <>
            <span aria-hidden className="size-5 shrink-0 rounded-[0.25rem] bg-current" />
            <span className="text-2xl font-bold tabular-nums" aria-hidden>
              {formatElapsed(meter.elapsedMs)}
            </span>
            <LevelMeter levels={meter.levels} reduce={!!reduce} />
          </>
        )}
        {mode === 'busy' && (
          <>
            <Loader2 aria-hidden className="size-7 shrink-0 animate-spin motion-reduce:animate-none" />
            <span className="text-lg font-semibold whitespace-nowrap">Transcribing…</span>
          </>
        )}
        {(mode === 'idle' || mode === 'starting') && <Mic aria-hidden className="size-9 shrink-0" strokeWidth={2.25} />}
      </m.button>
    </div>
  )
}

function LevelMeter({ levels, reduce }: { levels: number[]; reduce: boolean }) {
  const bar: Transition = reduce ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 32 }
  return (
    <span aria-hidden className="flex h-10 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden">
      {levels.map((level, i) => (
        <m.span
          key={i}
          className="h-full w-1 shrink-0 rounded-full bg-current"
          initial={false}
          animate={{ scaleY: Math.max(0.1, level) }}
          transition={bar}
        />
      ))}
    </span>
  )
}
