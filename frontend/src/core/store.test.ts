import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStore, historyBefore, type Turn } from './store'

const turn = (sessionId: string, createdAt: number, over: Partial<Turn> = {}): Turn => ({
  id: crypto.randomUUID(),
  sessionId,
  createdAt,
  sourceText: `said ${createdAt}`,
  detectedLang: 'ru',
  targetLang: 'ko',
  translation: `translated ${createdAt}`,
  confident: true,
  status: 'done',
  error: null,
  models: { stt: 'stt', translate: 'tr' },
  ...over,
})

it('keeps sessions, turns and used languages, and deletes a session with its turns', async () => {
  const store = createStore('round-trip')
  const first = await store.createSession(['ru', 'ko'])
  const second = await store.createSession(['ru', 'en'])
  const turns = [turn(first.id, 2), turn(first.id, 1), turn(second.id, 3)]
  await Promise.all(turns.map(store.putTurn))

  expect((await store.sessions()).map((s) => s.id)).toEqual([second.id, first.id])
  expect(await store.turns(first.id)).toEqual([turns[1], turns[0]])
  expect((await store.prefs()).usedLanguages).toEqual(['ru', 'en', 'ko'])

  await store.deleteSession(first.id)
  expect((await store.sessions()).map((s) => s.id)).toEqual([second.id])
  expect(await store.turns(first.id)).toEqual([])
  expect(await store.turns(second.id)).toEqual([turns[2]])
})

it('sends only translated turns before the current one as history', () => {
  const turns = [turn('s', 1), turn('s', 2, { status: 'failed', translation: null }), turn('s', 3), turn('s', 4)]
  expect(historyBefore(turns, turns[3].id, 1)).toEqual([
    { sourceLang: 'ru', source: 'said 3', targetLang: 'ko', translation: 'translated 3' },
  ])
  expect(historyBefore(turns, turns[3].id).map((h) => h.source)).toEqual(['said 1', 'said 3'])
})
