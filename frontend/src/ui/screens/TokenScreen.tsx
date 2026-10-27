import { useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { createApiClient, errorMessage } from '@/core/api'
import { apiBaseUrl } from '@/ui/client'
import { Button } from '@/ui/primitives/button'
import { Input } from '@/ui/primitives/input'
import { Label } from '@/ui/primitives/label'
import { Screen } from '@/ui/Screen'

export function TokenScreen({ notice, onSaved }: { notice?: string; onSaved: (token: string) => void }) {
  const [value, setValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState(notice ?? '')
  const [checking, setChecking] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const token = value.trim()
    if (!token) return setError('Enter the access token.')
    setChecking(true)
    setError('')
    try {
      // A cheap authenticated call proves the token before it is stored.
      await createApiClient({ baseUrl: apiBaseUrl, getToken: () => token }).languages()
      onSaved(token)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  return (
    <form onSubmit={submit} className="contents" noValidate>
      <Screen
        dock={
          <Button type="submit" size="lg" className="w-full" disabled={checking}>
            {checking ? 'Checking…' : 'Continue'}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-bold">Pocket Tolk</h1>
          <p className="text-base text-slate">
            Enter the access token for your Pocket Tolk server. It is kept on this device.
          </p>
        </div>
        <div className="mt-8 flex flex-col gap-2">
          <Label htmlFor="token">Access token</Label>
          <div className="relative">
            <Input
              id="token"
              type={visible ? 'text' : 'password'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="current-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              aria-invalid={!!error}
              aria-describedby={error ? 'token-error' : undefined}
              className="pr-14"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-0 right-0 rounded-l-none"
              aria-label={visible ? 'Hide token' : 'Show token'}
              aria-pressed={visible}
              onClick={() => setVisible((v) => !v)}
            >
              {visible ? <EyeOff /> : <Eye />}
            </Button>
          </div>
          {error && (
            <p id="token-error" role="alert" className="text-base font-semibold">
              {error}
            </p>
          )}
        </div>
      </Screen>
    </form>
  )
}
