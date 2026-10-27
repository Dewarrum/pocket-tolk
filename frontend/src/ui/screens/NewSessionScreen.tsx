import { useEffect, useState } from 'react'
import { ArrowUpDown, ChevronLeft } from 'lucide-react'
import type { Language } from '@/core/api'
import { store } from '@/ui/client'
import { Button } from '@/ui/primitives/button'
import { Label } from '@/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select'
import { Screen } from '@/ui/Screen'
import { useLanguageTable } from '@/ui/useLanguageTable'
import { voiceDot, type Voice } from '@/ui/voice'
import { cn } from '@/ui/lib/utils'

/** Languages pinned at the top of each picker, most recently used first. */
const MAX_PINNED = 6

export function NewSessionScreen({
  onStart,
  onBack,
  onUnauthorized,
}: {
  onStart: (languages: [Language, Language]) => void
  onBack: () => void
  onUnauthorized: () => void
}) {
  const { table: languages, error: loadError, retry } = useLanguageTable(onUnauthorized)
  const [used, setUsed] = useState<string[]>([])
  const [you, setYou] = useState('')
  const [they, setThey] = useState('')

  // The last conversation's pair is preselected; nothing is on first launch.
  useEffect(() => {
    let live = true
    store
      .prefs()
      .then(({ usedLanguages }) => {
        if (!live) return
        setUsed(usedLanguages)
        setYou((v) => v || (usedLanguages[0] ?? ''))
        setThey((v) => v || (usedLanguages[1] ?? ''))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const byCode = (code: string) => languages?.find((l) => l.code === code)
  const same = you !== '' && you === they
  const pair = !same ? ([byCode(you), byCode(they)] as const) : null
  const ready = pair?.[0] && pair[1] ? ([pair[0], pair[1]] as [Language, Language]) : null
  const pinned = used.slice(0, MAX_PINNED)

  return (
    <Screen
      header={
        <div className="flex h-16 items-center">
          <Button variant="ghost" size="icon" className="-ml-3" aria-label="All conversations" onClick={onBack}>
            <ChevronLeft />
          </Button>
        </div>
      }
      dock={
        <div className="flex flex-col gap-2">
          {same && (
            <p role="alert" className="text-center text-base font-semibold">
              Choose two different languages.
            </p>
          )}
          <Button size="lg" className="w-full" disabled={!ready} onClick={() => ready && onStart(ready)}>
            Start conversation
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold">New conversation</h1>
        <p className="text-base text-slate">Pick the two languages. Each person speaks their own.</p>
      </div>

      {loadError ? (
        <div role="alert" className="mt-8 flex flex-col items-start gap-4">
          <p className="text-base font-semibold">{loadError}</p>
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-2">
          <LanguagePicker
            id="you"
            label="You speak"
            voice="you"
            value={you}
            onChange={setYou}
            languages={languages}
            pinned={pinned}
          />
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Swap languages"
              disabled={!you && !they}
              onClick={() => {
                setYou(they)
                setThey(you)
              }}
            >
              <ArrowUpDown />
            </Button>
          </div>
          <LanguagePicker
            id="they"
            label="They speak"
            voice="they"
            value={they}
            onChange={setThey}
            languages={languages}
            pinned={pinned}
          />
        </div>
      )}
    </Screen>
  )
}

function LanguagePicker({
  id,
  label,
  voice,
  value,
  onChange,
  languages,
  pinned,
}: {
  id: string
  label: string
  voice: Voice
  value: string
  onChange: (code: string) => void
  languages: Language[] | null
  /** Codes shown first, under their own heading. */
  pinned: string[]
}) {
  const top = pinned.flatMap((code) => languages?.find((l) => l.code === code) ?? [])
  const rest = languages?.filter((l) => !pinned.includes(l.code)) ?? []
  const item = (l: Language) => (
    <SelectItem key={l.code} value={l.code}>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span lang={l.code} className="speech">
          {l.nativeName}
        </span>
        {l.nativeName !== l.name && <span className="text-sm text-slate">{l.name}</span>}
      </span>
    </SelectItem>
  )

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        <span aria-hidden className={cn('size-3 rounded-full', voiceDot[voice])} />
        {label}
      </Label>
      <Select value={value} onValueChange={onChange} disabled={!languages}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={languages ? 'Choose a language' : 'Loading languages…'} />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="max-h-[min(24rem,var(--radix-select-content-available-height))] w-(--radix-select-trigger-width)"
        >
          {top.length > 0 ? (
            <>
              <SelectGroup>
                <SelectLabel className="px-3 pt-2 pb-1 text-sm text-slate">Used before</SelectLabel>
                {top.map(item)}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel className="px-3 pt-2 pb-1 text-sm text-slate">All languages</SelectLabel>
                {rest.map(item)}
              </SelectGroup>
            </>
          ) : (
            languages?.map(item)
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
