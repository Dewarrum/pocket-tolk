import { useCallback, useEffect, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { ApiError, errorMessage, type Language } from '@/core/api'
import { api } from '@/ui/client'
import { Button } from '@/ui/primitives/button'
import { Label } from '@/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/primitives/select'
import { Screen } from '@/ui/Screen'
import { voiceDot, type Voice } from '@/ui/voice'
import { cn } from '@/ui/lib/utils'

export function NewSessionScreen({
  initial,
  onStart,
  onUnauthorized,
}: {
  initial?: readonly [Language, Language]
  onStart: (languages: [Language, Language]) => void
  onUnauthorized: () => void
}) {
  const [languages, setLanguages] = useState<Language[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [you, setYou] = useState(initial?.[0].code ?? '')
  const [they, setThey] = useState(initial?.[1].code ?? '')

  const load = useCallback(
    (signal?: AbortSignal) => {
      api
        .languages(signal)
        .then(setLanguages)
        .catch((err: unknown) => {
          if (signal?.aborted) return
          if (err instanceof ApiError && err.code === 'unauthorized') return onUnauthorized()
          setLoadError(errorMessage(err))
        })
    },
    [onUnauthorized],
  )

  useEffect(() => {
    const abort = new AbortController()
    load(abort.signal)
    return () => abort.abort()
  }, [load])

  const byCode = (code: string) => languages?.find((l) => l.code === code)
  const same = you !== '' && you === they
  const pair = !same ? ([byCode(you), byCode(they)] as const) : null
  const ready = pair?.[0] && pair[1] ? ([pair[0], pair[1]] as [Language, Language]) : null

  return (
    <Screen
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
          <Button variant="outline" onClick={() => {
              setLoadError('')
              load()
            }}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-2">
          <LanguagePicker id="you" label="You speak" voice="you" value={you} onChange={setYou} languages={languages} />
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
          <LanguagePicker id="they" label="They speak" voice="they" value={they} onChange={setThey} languages={languages} />
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
}: {
  id: string
  label: string
  voice: Voice
  value: string
  onChange: (code: string) => void
  languages: Language[] | null
}) {
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
          {languages?.map((l) => (
            <SelectItem key={l.code} value={l.code}>
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span lang={l.code} className="speech">
                  {l.nativeName}
                </span>
                {l.nativeName !== l.name && <span className="text-sm text-slate">{l.name}</span>}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
