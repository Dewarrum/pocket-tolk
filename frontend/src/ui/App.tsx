import { useCallback, useState } from 'react'
import { domAnimation, LazyMotion } from 'motion/react'
import type { Language } from '@/core/api'
import { tokenStore } from '@/ui/client'
import { Toaster } from '@/ui/primitives/sonner'
import { NewSessionScreen } from '@/ui/screens/NewSessionScreen'
import { SessionScreen } from '@/ui/screens/SessionScreen'
import { TokenScreen } from '@/ui/screens/TokenScreen'

// Sessions live in memory in this slice; IndexedDB arrives with slice 2.
export function App() {
  const [token, setToken] = useState(tokenStore.get)
  const [notice, setNotice] = useState<string>()
  const [session, setSession] = useState<readonly [Language, Language] | null>(null)
  const [lastPair, setLastPair] = useState<readonly [Language, Language]>()

  const unauthorized = useCallback(() => {
    tokenStore.clear()
    setToken(null)
    setNotice('The access token was not accepted. Enter it again.')
  }, [])

  const leave = useCallback(() => setSession(null), [])

  let screen
  if (!token) {
    screen = (
      <TokenScreen
        notice={notice}
        onSaved={(t) => {
          tokenStore.set(t)
          setNotice(undefined)
          setToken(t)
        }}
      />
    )
  } else if (!session) {
    screen = (
      <NewSessionScreen
        initial={lastPair}
        onUnauthorized={unauthorized}
        onStart={(pair) => {
          setLastPair(pair)
          setSession(pair)
        }}
      />
    )
  } else {
    screen = <SessionScreen languages={session} onLeave={leave} onUnauthorized={unauthorized} />
  }

  return (
    <LazyMotion features={domAnimation} strict>
      {screen}
      <Toaster position="top-center" duration={6000} />
    </LazyMotion>
  )
}
