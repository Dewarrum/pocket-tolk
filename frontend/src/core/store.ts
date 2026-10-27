// Conversations kept on this device, in IndexedDB. Text only: audio is never
// stored. Framework-free.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { HistoryEntry } from './api'

/** Turns sent as context with each translation (the backend may keep fewer). */
export const HISTORY_TURNS = 10

export interface Session {
  id: string
  createdAt: number
  /** [you, they]: the owner's language first. */
  languages: [string, string]
}

export type TurnStatus = 'translating' | 'done' | 'failed'

export interface Turn {
  id: string
  sessionId: string
  createdAt: number
  sourceText: string
  /** A session language or `other`; null until translated. */
  detectedLang: string | null
  targetLang: string | null
  translation: string | null
  confident: boolean | null
  status: TurnStatus
  /** What went wrong, for the person holding the phone. */
  error: string | null
  models: { stt: string | null; translate: string | null }
}

export interface Prefs {
  /** Languages of past sessions, most recent first. */
  usedLanguages: string[]
}

interface Schema extends DBSchema {
  sessions: { key: string; value: Session; indexes: { createdAt: number } }
  turns: { key: string; value: Turn; indexes: { session: [string, number] } }
  prefs: { key: 'prefs'; value: Prefs }
}

const emptyPrefs: Prefs = { usedLanguages: [] }

/** Opens the database lazily on first use. */
export function createStore(name = 'pocket-tolk') {
  let db: Promise<IDBPDatabase<Schema>> | undefined
  const open = () =>
    (db ??= openDB<Schema>(name, 1, {
      upgrade(db) {
        db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
        db.createObjectStore('turns', { keyPath: 'id' }).createIndex('session', ['sessionId', 'createdAt'])
        db.createObjectStore('prefs')
      },
    }))
  const turnsOf = (sessionId: string) => IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity])

  return {
    /** Creates a session and moves its languages to the front of the used ones. */
    async createSession(languages: [string, string]): Promise<Session> {
      const session: Session = { id: crypto.randomUUID(), createdAt: Date.now(), languages }
      const tx = (await open()).transaction(['sessions', 'prefs'], 'readwrite')
      const prefs = (await tx.objectStore('prefs').get('prefs')) ?? emptyPrefs
      const usedLanguages = [...languages, ...prefs.usedLanguages.filter((code) => !languages.includes(code))]
      await Promise.all([
        tx.objectStore('sessions').add(session),
        tx.objectStore('prefs').put({ ...prefs, usedLanguages }, 'prefs'),
        tx.done,
      ])
      return session
    },

    /** Newest first. */
    async sessions(): Promise<Session[]> {
      return (await (await open()).getAllFromIndex('sessions', 'createdAt')).reverse()
    },

    /** Deletes the session and its turns. */
    async deleteSession(id: string): Promise<void> {
      const tx = (await open()).transaction(['sessions', 'turns'], 'readwrite')
      await tx.objectStore('sessions').delete(id)
      for await (const cursor of tx.objectStore('turns').index('session').iterate(turnsOf(id))) {
        await cursor.delete()
      }
      await tx.done
    },

    /** Oldest first. */
    async turns(sessionId: string): Promise<Turn[]> {
      return (await open()).getAllFromIndex('turns', 'session', turnsOf(sessionId))
    },

    async putTurn(turn: Turn): Promise<void> {
      await (await open()).put('turns', turn)
    },

    async prefs(): Promise<Prefs> {
      return (await (await open()).get('prefs', 'prefs')) ?? emptyPrefs
    },
  }
}

export type Store = ReturnType<typeof createStore>

/** The translated turns before `turnId`, oldest first, as translation context. */
export function historyBefore(turns: readonly Turn[], turnId: string, limit = HISTORY_TURNS): HistoryEntry[] {
  const end = turns.findIndex((t) => t.id === turnId)
  return turns
    .slice(0, end < 0 ? turns.length : end)
    .filter((t) => t.status === 'done' && t.detectedLang && t.targetLang && t.translation)
    .slice(-limit)
    .map((t) => ({
      sourceLang: t.detectedLang!,
      source: t.sourceText,
      targetLang: t.targetLang!,
      translation: t.translation!,
    }))
}
