import { useEffect, useReducer, useState } from 'react'
import { ArrowLeftRight, ChevronLeft, CircleAlert, Plus, RotateCcw, RotateCw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, errorMessage, type Language } from '@/core/api'
import { MAX_CLIP_MS, RecorderError } from '@/core/recorder'
import { guessLanguage } from '@/core/script'
import { hintFor, initialTurn, transition, type TurnEvent } from '@/core/turnMachine'
import { api } from '@/ui/client'
import { cn } from '@/ui/lib/utils'
import { Button } from '@/ui/primitives/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/dialog'
import { Textarea } from '@/ui/primitives/textarea'
import { LanguageChip } from '@/ui/LanguageChip'
import { RecordButton, type RecordMode } from '@/ui/RecordButton'
import { Screen } from '@/ui/Screen'
import { useRecorder } from '@/ui/useRecorder'
import { formatElapsed, voiceRule, voiceText, type Voice } from '@/ui/voice'

export function SessionScreen({
  languages,
  onLeave,
  onUnauthorized,
}: {
  languages: readonly [Language, Language]
  onLeave: () => void
  onUnauthorized: () => void
}) {
  const [turn, dispatch] = useReducer(transition, initialTurn)
  const recorder = useRecorder()
  const [starting, setStarting] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [you, they] = languages

  useEffect(() => {
    if (turn.status !== 'transcribing') return
    const abort = new AbortController()
    api
      .transcribe({ audio: turn.clip.blob, languages: [you.code, they.code], hint: hintFor(turn), signal: abort.signal })
      .then((res) => dispatch({ type: 'transcribed', text: res.text }))
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        if (err instanceof ApiError && err.code === 'unauthorized') return onUnauthorized()
        dispatch({ type: 'transcriptionFailed', error: errorMessage(err) })
      })
    return () => abort.abort()
  }, [turn, you.code, they.code, onUnauthorized])

  // The machine enters `recording` only once the microphone is live, so a
  // refused microphone never discards text.
  async function record(event: Extract<TurnEvent['type'], 'record' | 'recordAgain' | 'addMore'>) {
    if (starting) return
    setStarting(true)
    try {
      await recorder.start((clip) => {
        toast.info(`Stopped at the ${formatElapsed(MAX_CLIP_MS)} limit.`)
        dispatch({ type: 'stop', clip })
      })
      dispatch({ type: event })
    } catch (err) {
      toast.error(err instanceof RecorderError ? err.message : 'The microphone could not be started.')
    } finally {
      setStarting(false)
    }
  }

  async function stop() {
    const clip = await recorder.stop()
    if (clip) dispatch({ type: 'stop', clip })
  }

  const mode: RecordMode =
    turn.status === 'recording' ? 'live' : turn.status === 'transcribing' ? 'busy' : starting ? 'starting' : 'idle'
  const unsentText =
    turn.status === 'review' ? turn.text : turn.status === 'idle' ? '' : (('base' in turn && turn.base) || '')
  const voiceOf = (text: string): { lang: string; voice?: Voice } => {
    const lang = guessLanguage(text, [you.code, they.code])
    return { lang: lang ?? '', voice: lang === you.code ? 'you' : lang === they.code ? 'they' : undefined }
  }

  function leave() {
    if (unsentText.trim() || turn.status === 'recording') setConfirmLeave(true)
    else onLeave()
  }

  const header = (
    <div className="flex h-16 items-center gap-1">
      <Button variant="ghost" size="icon" className="-ml-3" aria-label="Change languages" onClick={leave}>
        <ChevronLeft />
      </Button>
      <h1 className="sr-only">
        Conversation in {you.name} and {they.name}
      </h1>
      <div className="flex min-w-0 items-center gap-2">
        <LanguageChip language={you} voice="you" />
        <ArrowLeftRight aria-hidden className="size-5 shrink-0 text-slate" />
        <LanguageChip language={they} voice="they" />
      </div>
    </div>
  )

  let words: React.ReactNode
  let dock: React.ReactNode

  switch (turn.status) {
    case 'idle':
    case 'recording':
    case 'transcribing': {
      const base = turn.status === 'idle' ? null : turn.base
      words = base ? (
        <SpokenText text={base} {...voiceOf(base)} muted />
      ) : turn.status === 'idle' ? (
        <div className="flex flex-col gap-3">
          <p className="text-2xl font-bold text-balance">Tap the button and speak.</p>
          <p className="text-base text-slate">
            <span lang={you.code} className={cn('speech font-semibold', voiceText.you)}>{you.nativeName}</span>
            {' or '}
            <span lang={they.code} className={cn('speech font-semibold', voiceText.they)}>{they.nativeName}</span>
            . The other person answers with the same button.
          </p>
        </div>
      ) : turn.status === 'recording' ? (
        <p className="text-2xl font-bold text-slate">Listening…</p>
      ) : null
      dock = (
        <div className="flex flex-col items-center gap-3">
          <RecordButton
            mode={mode}
            meter={recorder.meter}
            onPress={turn.status === 'recording' ? stop : () => record('record')}
            describedBy="record-hint"
          />
          <p id="record-hint" className="text-sm text-slate">
            {turn.status === 'recording'
              ? `Tap to stop. Stops by itself at ${formatElapsed(MAX_CLIP_MS)}.`
              : turn.status === 'transcribing'
                ? (base ? 'Adding to the text above.' : 'Turning speech into text.')
                : 'Tap to speak'}
          </p>
        </div>
      )
      break
    }

    case 'review': {
      const { lang, voice } = voiceOf(turn.text)
      words = (
        <div className="flex flex-col gap-2">
          <label htmlFor="heard" className="text-sm text-slate">
            What was heard. Fix anything that is wrong.
          </label>
          <Textarea
            id="heard"
            lang={lang}
            dir="auto"
            value={turn.text}
            onChange={(e) => dispatch({ type: 'edit', text: e.target.value })}
            placeholder="Nothing was recognised. Type the text or record again."
            className={cn(
              'speech min-h-[4lh] resize-none rounded-none rounded-r-xl border-0 border-l-4 bg-sheet px-4 py-3 text-xl shadow-none',
              voice ? voiceRule[voice] : 'border-l-rule',
            )}
          />
        </div>
      )
      dock = (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => record('recordAgain')} disabled={starting}>
              <RotateCcw /> Record again
            </Button>
            <Button variant="outline" onClick={() => record('addMore')} disabled={starting}>
              <Plus /> Add more
            </Button>
          </div>
          <Button size="lg" disabled aria-describedby="send-hint">
            <Send /> Send
          </Button>
          <p id="send-hint" className="text-center text-sm text-slate">
            Translation is coming next.
          </p>
        </div>
      )
      break
    }

    case 'failed': {
      words = (
        <div className="flex flex-col gap-5">
          {turn.base && <SpokenText text={turn.base} {...voiceOf(turn.base)} muted />}
          <div role="alert" className="flex gap-3">
            <CircleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">That clip was not transcribed.</p>
              <p className="text-base text-slate">{turn.error}</p>
            </div>
          </div>
        </div>
      )
      dock = (
        <div className="flex flex-col gap-3">
          <Button size="lg" onClick={() => dispatch({ type: 'retry' })}>
            <RotateCw /> Retry
          </Button>
          <div className={cn('grid gap-3', turn.base ? 'grid-cols-2' : 'grid-cols-1')}>
            <Button variant="outline" onClick={() => record('recordAgain')} disabled={starting}>
              <RotateCcw /> Record again
            </Button>
            {turn.base && (
              <Button variant="ghost" onClick={() => dispatch({ type: 'cancel' })}>
                Back to the text
              </Button>
            )}
          </div>
        </div>
      )
      break
    }

    default:
      words = null
  }

  return (
    <>
      <Screen header={header} dock={dock}>
        {words}
      </Screen>
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <DialogContent
          showCloseButton={false}
          className="top-auto bottom-[max(1.25rem,env(safe-area-inset-bottom))] translate-y-0 gap-5 p-5"
        >
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">Leave this conversation?</DialogTitle>
            <DialogDescription className="text-base">The text you have not sent will be lost.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="-mx-5 -mb-5 grid grid-cols-2 gap-3 bg-transparent p-5 pt-0 border-t-0">
            <DialogClose asChild>
              <Button variant="outline">Stay</Button>
            </DialogClose>
            <Button
              onClick={() => {
                recorder.cancel()
                onLeave()
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function SpokenText({ text, lang, voice, muted }: { text: string; lang: string; voice?: Voice; muted?: boolean }) {
  return (
    <p
      lang={lang}
      dir="auto"
      className={cn(
        'speech border-l-4 py-1 pl-4 text-xl whitespace-pre-wrap',
        voice ? voiceRule[voice] : 'border-l-rule',
        muted && 'text-slate',
      )}
    >
      {text}
    </p>
  )
}
