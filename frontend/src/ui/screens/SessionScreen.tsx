import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  ArrowLeftRight,
  ChevronLeft,
  CircleAlert,
  CircleHelp,
  Loader2,
  Plus,
  RotateCcw,
  RotateCw,
  Send,
} from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { ApiError, errorMessage, type Language } from '@/core/api'
import { MAX_CLIP_MS, RecorderError } from '@/core/recorder'
import { guessLanguage } from '@/core/script'
import { historyBefore, type Session, type Turn } from '@/core/store'
import { hintFor, initialTurn, transition, type TurnEvent } from '@/core/turnMachine'
import { api, languageFor, store } from '@/ui/client'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { cn } from '@/ui/lib/utils'
import { Button } from '@/ui/primitives/button'
import { Textarea } from '@/ui/primitives/textarea'
import { LanguageChip } from '@/ui/LanguageChip'
import { RecordButton, type RecordMode } from '@/ui/RecordButton'
import { Screen } from '@/ui/Screen'
import { useLanguageTable } from '@/ui/useLanguageTable'
import { useRecorder } from '@/ui/useRecorder'
import { formatElapsed, voiceDot, voiceRule, voiceText, type Voice } from '@/ui/voice'

export function SessionScreen({
  session,
  onLeave,
  onUnauthorized,
}: {
  session: Session
  onLeave: () => void
  onUnauthorized: () => void
}) {
  const { table } = useLanguageTable(onUnauthorized)
  const you = languageFor(session.languages[0], table)
  const they = languageFor(session.languages[1], table)
  const codes = session.languages
  const [turn, dispatch] = useReducer(transition, initialTurn)
  const { turns, latest, save } = useTurns(session.id)
  const sttModel = useRef<string | null>(null)
  const recorder = useRecorder()
  const [starting, setStarting] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (turn.status !== 'transcribing') return
    const abort = new AbortController()
    api
      .transcribe({ audio: turn.clip.blob, languages: codes, hint: hintFor(turn), signal: abort.signal })
      .then((res) => {
        sttModel.current = res.model
        dispatch({ type: 'transcribed', text: res.text })
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        if (err instanceof ApiError && err.code === 'unauthorized') return onUnauthorized()
        dispatch({ type: 'transcriptionFailed', error: errorMessage(err) })
      })
    return () => abort.abort()
  }, [turn, codes, onUnauthorized])

  // The turn is stored before `send`; it is updated here when the answer arrives.
  useEffect(() => {
    if (turn.status !== 'translating') return
    const stored = latest.current.find((t) => t.id === turn.turnId)
    if (!stored) return
    const abort = new AbortController()
    api
      .translate({
        languages: codes,
        text: turn.text,
        history: historyBefore(latest.current, turn.turnId),
        signal: abort.signal,
      })
      .then((res) => {
        save({
          ...stored,
          status: 'done',
          detectedLang: res.detectedLang,
          targetLang: res.targetLang,
          translation: res.translation,
          confident: res.confident,
          error: null,
          models: { ...stored.models, translate: res.model },
        })
        dispatch({ type: 'translated' })
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return
        const error = errorMessage(err, 'translation')
        save({ ...stored, status: 'failed', error })
        dispatch({ type: 'translationFailed', error })
        if (err instanceof ApiError && err.code === 'unauthorized') onUnauthorized()
      })
    return () => abort.abort()
  }, [turn, codes, latest, save, onUnauthorized])

  // New words appear at the bottom, just above the dock. Opening a
  // conversation jumps there; later changes scroll there.
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (!turns) return
    const smooth = opened.current && !reduceMotion
    opened.current = true
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'instant' })
  }, [turns, turn.status, reduceMotion])

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

  function send() {
    if (turn.status !== 'review' || !turn.text.trim()) return
    const stored: Turn = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      createdAt: Date.now(),
      sourceText: turn.text.trim(),
      detectedLang: null,
      targetLang: null,
      translation: null,
      confident: null,
      status: 'translating',
      error: null,
      models: { stt: sttModel.current, translate: null },
    }
    save(stored)
    dispatch({ type: 'send', turnId: stored.id })
  }

  const canRetranslate =
    turn.status === 'idle' || turn.status === 'done' || (turn.status === 'failed' && turn.stage === 'translate')

  function retranslate(failed: Turn) {
    if (!canRetranslate) return
    save({ ...failed, status: 'translating', error: null })
    const current = turn.status === 'failed' && turn.stage === 'translate' && turn.turnId === failed.id
    dispatch(current ? { type: 'retry' } : { type: 'retranslate', turnId: failed.id, text: failed.sourceText })
  }

  const mode: RecordMode =
    turn.status === 'recording'
      ? 'live'
      : turn.status === 'transcribing'
        ? 'busy'
        : turn.status === 'translating'
          ? 'waiting'
          : starting
            ? 'starting'
            : 'idle'
  const unsentText = turn.status === 'review' ? turn.text : ('base' in turn && turn.base) || ''
  const voiceOf = (lang: string | undefined): Voice | undefined =>
    lang === you.code ? 'you' : lang === they.code ? 'they' : undefined
  const guess = (text: string) => guessLanguage(text, codes)

  // A conversation left without a single turn is not worth listing.
  function leaveNow() {
    if (turns?.length === 0) store.deleteSession(session.id).catch(() => {})
    onLeave()
  }

  function leave() {
    if (unsentText.trim() || turn.status === 'recording') setConfirmLeave(true)
    else leaveNow()
  }

  const header = (
    <div className="flex h-16 items-center gap-1">
      <Button variant="ghost" size="icon" className="-ml-3" aria-label="All conversations" onClick={leave}>
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

  if (!turns) return <Screen header={header}>{null}</Screen>

  let current: React.ReactNode = null
  let dock: React.ReactNode

  if (turn.status === 'review') {
    const lang = guess(turn.text)
    const voice = voiceOf(lang)
    current = (
      <div className="flex flex-col gap-2">
        <label htmlFor="heard" className="text-sm text-slate">
          What was heard. Fix anything that is wrong.
        </label>
        <Textarea
          id="heard"
          lang={lang ?? ''}
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
        <Button size="lg" onClick={send} disabled={!turn.text.trim()}>
          <Send /> Send
        </Button>
      </div>
    )
  } else if (turn.status === 'failed' && turn.stage === 'transcribe') {
    current = (
      <div className="flex flex-col gap-5">
        {turn.base && <SpokenText text={turn.base} lang={guess(turn.base)} voice={voiceOf(guess(turn.base))} muted />}
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
  } else {
    // A failed translation shows on its turn; the dock is ready for the next one.
    const base = 'base' in turn ? turn.base : null
    if (base) current = <SpokenText text={base} lang={guess(base)} voice={voiceOf(guess(base))} muted />
    else if (turn.status === 'recording') current = <p className="text-2xl font-bold text-slate">Listening…</p>
    else if (turns.length === 0 && turn.status === 'idle') {
      current = (
        <div className="flex flex-col gap-3">
          <p className="text-2xl font-bold text-balance">Tap the button and speak.</p>
          <p className="text-base text-slate">
            <span lang={you.code} className={cn('speech font-semibold', voiceText.you)}>
              {you.nativeName}
            </span>
            {' or '}
            <span lang={they.code} className={cn('speech font-semibold', voiceText.they)}>
              {they.nativeName}
            </span>
            . The other person answers with the same button.
          </p>
        </div>
      )
    }
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
              ? base
                ? 'Adding to the text above.'
                : 'Turning speech into text.'
              : turn.status === 'translating'
                ? 'Wait for the translation above.'
                : 'Tap to speak'}
        </p>
      </div>
    )
  }

  return (
    <>
      <Screen header={header} dock={dock}>
        <div className="flex flex-col gap-8">
          {turns.length > 0 && (
            <ol aria-label="Turns" className="flex flex-col gap-8">
              {turns.map((t, i) => (
                <TurnView
                  key={t.id}
                  turn={t}
                  latest={i === turns.length - 1}
                  sourceLang={t.detectedLang && t.detectedLang !== 'other' ? t.detectedLang : guess(t.sourceText)}
                  languageOf={(code) => languageFor(code, table)}
                  voiceOf={voiceOf}
                  pair={[you, they]}
                  canRetry={canRetranslate}
                  onRetry={() => retranslate(t)}
                />
              ))}
            </ol>
          )}
          {current}
        </div>
      </Screen>
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this conversation?"
        description="The text you have not sent will be lost."
        cancel="Stay"
        confirm="Leave"
        onConfirm={() => {
          recorder.cancel()
          leaveNow()
        }}
      />
    </>
  )
}

/**
 * The session's stored turns, oldest first. `latest` mirrors the list
 * synchronously so a turn saved before `send` is visible to the effect that
 * translates it.
 */
function useTurns(sessionId: string) {
  const [turns, setTurns] = useState<Turn[] | null>(null)
  const latest = useRef<Turn[]>([])

  useEffect(() => {
    let live = true
    store
      .turns(sessionId)
      .then(async (stored) => {
        // A turn still translating was cut off by a reload or by leaving the screen.
        const loaded = stored.map((t): Turn =>
          t.status === 'translating' ? { ...t, status: 'failed', error: 'The translation did not finish.' } : t,
        )
        await Promise.all(loaded.filter((t, i) => t !== stored[i]).map(store.putTurn))
        if (!live) return
        latest.current = loaded
        setTurns(loaded)
      })
      .catch(() => {
        if (live) setTurns([])
        toast.error('The saved turns could not be read on this device.')
      })
    return () => {
      live = false
    }
  }, [sessionId])

  const save = useCallback((turn: Turn) => {
    const i = latest.current.findIndex((t) => t.id === turn.id)
    latest.current = i < 0 ? [...latest.current, turn] : latest.current.with(i, turn)
    setTurns(latest.current)
    store.putTurn(turn).catch(() => toast.error('This turn could not be saved on this device.'))
  }, [])

  return { turns, latest, save }
}

function TurnView({
  turn,
  latest,
  sourceLang,
  languageOf,
  voiceOf,
  pair,
  canRetry,
  onRetry,
}: {
  turn: Turn
  latest: boolean
  sourceLang: string | undefined
  languageOf: (code: string) => Language
  voiceOf: (code: string | undefined) => Voice | undefined
  pair: readonly [Language, Language]
  canRetry: boolean
  onRetry: () => void
}) {
  const voice = voiceOf(sourceLang)
  const detected = turn.detectedLang && turn.detectedLang !== 'other' ? languageOf(turn.detectedLang) : null
  return (
    <li className={cn('flex flex-col gap-2 border-l-4 pl-4', voice ? voiceRule[voice] : 'border-l-rule')}>
      {detected && (
        <p className="flex items-center gap-2 text-sm text-slate">
          <span aria-hidden className={cn('size-2.5 rounded-full', voice ? voiceDot[voice] : 'bg-rule')} />
          <span lang={detected.code} className="speech">
            {detected.nativeName}
          </span>
        </p>
      )}
      {turn.confident === false && turn.targetLang && (
        <p className="flex items-start gap-2 text-sm">
          <CircleHelp aria-hidden className="mt-px size-4 shrink-0" />
          <span>
            Not recognised as{' '}
            <span lang={pair[0].code} className="speech">
              {pair[0].nativeName}
            </span>{' '}
            or{' '}
            <span lang={pair[1].code} className="speech">
              {pair[1].nativeName}
            </span>
            . Translated into{' '}
            <span lang={turn.targetLang} className="speech">
              {languageOf(turn.targetLang).nativeName}
            </span>{' '}
            as a best guess.
          </span>
        </p>
      )}
      <p lang={sourceLang ?? ''} dir="auto" className="speech text-base whitespace-pre-wrap text-slate">
        {turn.sourceText}
      </p>

      {turn.status === 'done' && turn.translation && (
        <p
          lang={turn.targetLang ?? ''}
          dir="auto"
          className={cn('speech whitespace-pre-wrap', latest ? 'text-4xl' : 'text-2xl')}
        >
          {turn.translation}
        </p>
      )}
      {turn.status === 'translating' && (
        <p className="flex items-center gap-2 text-lg text-slate">
          <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          Translating…
        </p>
      )}

      {turn.status === 'failed' && (
        <div role="alert" className="flex flex-col items-start gap-3 pt-1">
          <div className="flex gap-3">
            <CircleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
            <div className="flex flex-col gap-1">
              <p className="text-lg font-semibold">Not translated.</p>
              <p className="text-base text-slate">{turn.error}</p>
            </div>
          </div>
          <Button variant="outline" onClick={onRetry} disabled={!canRetry}>
            <RotateCw /> Retry
          </Button>
        </div>
      )}
    </li>
  )
}

function SpokenText({ text, lang, voice, muted }: { text: string; lang?: string; voice?: Voice; muted?: boolean }) {
  return (
    <p
      lang={lang ?? ''}
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
