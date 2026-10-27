import { useCallback, useState } from 'react'
import { domAnimation, LazyMotion } from 'motion/react'
import { toast } from 'sonner'
import type { Session } from '@/core/store'
import { store, tokenStore } from '@/ui/client'
import { Toaster } from '@/ui/primitives/sonner'
import { HomeScreen } from '@/ui/screens/HomeScreen'
import { NewSessionScreen } from '@/ui/screens/NewSessionScreen'
import { SessionScreen } from '@/ui/screens/SessionScreen'
import { TokenScreen } from '@/ui/screens/TokenScreen'

type View = { name: 'home' } | { name: 'new' } | { name: 'session'; session: Session }

export function App() {
  const [token, setToken] = useState(tokenStore.get)
  const [notice, setNotice] = useState<string>()
  const [view, setView] = useState<View>({ name: 'home' })

  const unauthorized = useCallback(() => {
    tokenStore.clear()
    setToken(null)
    setNotice('The server password was not accepted. Enter it again.')
  }, [])

  const home = useCallback(() => setView({ name: 'home' }), [])

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
  } else if (view.name === 'home') {
    screen = (
      <HomeScreen
        onOpen={(session) => setView({ name: 'session', session })}
        onNew={() => setView({ name: 'new' })}
        onUnauthorized={unauthorized}
      />
    )
  } else if (view.name === 'new') {
    screen = (
      <NewSessionScreen
        onBack={home}
        onUnauthorized={unauthorized}
        onStart={(pair) => {
          store
            .createSession([pair[0].code, pair[1].code])
            .then((session) => setView({ name: 'session', session }))
            .catch(() => toast.error('The conversation could not be saved on this device.'))
        }}
      />
    )
  } else {
    screen = <SessionScreen key={view.session.id} session={view.session} onLeave={home} onUnauthorized={unauthorized} />
  }

  return (
    <LazyMotion features={domAnimation} strict>
      {screen}
      <Toaster position="top-center" duration={6000} />
    </LazyMotion>
  )
}
