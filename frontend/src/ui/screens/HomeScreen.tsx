import { useEffect, useRef, useState, type FocusEvent } from 'react'
import { ArrowLeftRight, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Language } from '@/core/api'
import type { Session } from '@/core/store'
import { languageFor, store } from '@/ui/client'
import { ConfirmDialog } from '@/ui/ConfirmDialog'
import { LanguageChip } from '@/ui/LanguageChip'
import { Button } from '@/ui/primitives/button'
import { Screen } from '@/ui/Screen'
import { useLanguageTable } from '@/ui/useLanguageTable'

export function HomeScreen({
  onOpen,
  onNew,
  onUnauthorized,
}: {
  onOpen: (session: Session) => void
  onNew: () => void
  onUnauthorized: () => void
}) {
  const { table } = useLanguageTable(onUnauthorized)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [deleting, setDeleting] = useState<{ session: Session; close: () => void } | null>(null)

  useEffect(() => {
    let live = true
    store
      .sessions()
      .then((list) => live && setSessions(list))
      .catch(() => {
        if (live) setSessions([])
        toast.error('Saved conversations could not be read on this device.')
      })
    return () => {
      live = false
    }
  }, [])

  async function remove(session: Session) {
    setDeleting(null)
    try {
      await store.deleteSession(session.id)
      setSessions((list) => list?.filter((s) => s.id !== session.id) ?? null)
      toast.success('Conversation deleted.')
    } catch {
      toast.error('The conversation could not be deleted.')
    }
  }

  const pair = (s: Session) => [languageFor(s.languages[0], table), languageFor(s.languages[1], table)] as const

  return (
    <Screen
      dock={
        <Button size="lg" className="w-full" onClick={onNew}>
          <Plus /> New conversation
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">Conversations</h1>
        {sessions?.length === 0 && (
          <p className="text-base text-slate">
            None yet. Start one, pick the two languages, and pass the phone back and forth.
          </p>
        )}
      </div>

      {sessions && sessions.length > 0 && (
        <>
          <ul className="mt-6 border-t border-rule">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                languages={pair(s)}
                onOpen={() => onOpen(s)}
                onDelete={(close) => setDeleting({ session: s, close })}
              />
            ))}
          </ul>
          <p className="mt-4 text-sm text-slate">Swipe a conversation left to delete it.</p>
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (open) return
          deleting?.close()
          setDeleting(null)
        }}
        title="Delete this conversation?"
        description="Its turns are removed from this device. This cannot be undone."
        cancel="Keep"
        confirm="Delete"
        onConfirm={() => deleting && remove(deleting.session)}
      />
    </Screen>
  )
}

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const day = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' })
const dayOfYear = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Today at 14:05", "Yesterday at 9:12", "Mon, 26 Oct at 14:05", "26 Oct 2025". */
function formatStarted(ms: number, now = new Date()): string {
  const date = new Date(ms)
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (ms >= midnight) return `Today at ${time.format(date)}`
  if (ms >= midnight - 864e5) return `Yesterday at ${time.format(date)}`
  if (date.getFullYear() === now.getFullYear()) return `${day.format(date)} at ${time.format(date)}`
  return dayOfYear.format(date)
}

/**
 * One conversation. Swiping it left reveals Delete (CSS scroll snap does the
 * gesture); Tab reaches Delete too, and focus back on the row closes it.
 */
function SessionRow({
  session,
  languages,
  onOpen,
  onDelete,
}: {
  session: Session
  languages: readonly [Language, Language]
  onOpen: () => void
  onDelete: (close: () => void) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const close = () => track.current?.scrollTo({ left: 0 })
  const [you, they] = languages

  return (
    <li className="border-b border-rule">
      <div ref={track} className="swipe-reveal">
        <button
          type="button"
          onClick={onOpen}
          onFocus={(e: FocusEvent<HTMLButtonElement>) => {
            if (e.currentTarget.matches(':focus-visible')) close()
          }}
          className="flex min-h-20 items-center gap-3 bg-paper py-3 text-left [-webkit-touch-callout:none] focus-visible:outline-offset-[-2px]"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <LanguageChip language={you} voice="you" />
              <ArrowLeftRight aria-hidden className="size-4 shrink-0 text-slate" />
              <LanguageChip language={they} voice="they" />
            </span>
            <span className="text-sm text-slate">{formatStarted(session.createdAt)}</span>
          </span>
          <ChevronRight aria-hidden className="size-5 shrink-0 text-slate" />
        </button>
        <div className="flex items-stretch py-2 pl-3">
          <Button
            className="h-full rounded-xl px-5"
            aria-label={`Delete the conversation in ${you.name} and ${they.name}, ${formatStarted(session.createdAt)}`}
            onClick={() => onDelete(close)}
          >
            <Trash2 /> Delete
          </Button>
        </div>
      </div>
    </li>
  )
}
