import { useEffect, useState } from 'react'
import { ApiError, errorMessage, type Language } from '@/core/api'
import { loadLanguages } from '@/ui/client'

/** The supported-language table from the server, with its load error and a retry. */
export function useLanguageTable(onUnauthorized: () => void) {
  const [table, setTable] = useState<Language[] | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    loadLanguages()
      .then((t) => live && setTable(t))
      .catch((err: unknown) => {
        if (!live) return
        if (err instanceof ApiError && err.code === 'unauthorized') return onUnauthorized()
        setError(errorMessage(err))
      })
    return () => {
      live = false
    }
  }, [attempt, onUnauthorized])

  const retry = () => {
    setError('')
    setAttempt((n) => n + 1)
  }
  return { table, error, retry }
}
