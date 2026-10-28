// The life of one turn, as pure functions. Framework-free.
//
// idle → recording → transcribing → review → translating → speaking → done
// review → recording(append) → transcribing(append) → review
// transcribing → failed(transcribe) → retry | record again | back to the text
// translating → failed(translate) → retry
// speaking → failed(speak): the server voice failed and the device's own voice
//   takes over. The translation stands, so it is settled like done.
// speaking → recording: answering cuts the voice off
// done, failed(translate | speak) → recording: the next turn; a failed turn stays in the list
// idle, done, failed(translate | speak) → translating: retranslate a failed turn from the list
//
// `base` is the text a new clip will be appended to (Add more); null for a fresh clip.
// `turnId` is the stored turn being translated; the caller stores it before `send`.

import type { Clip } from './recorder'

export type TurnState =
  | { status: 'idle' }
  | { status: 'recording'; base: string | null }
  | { status: 'transcribing'; base: string | null; clip: Clip }
  | { status: 'review'; text: string }
  | { status: 'failed'; stage: 'transcribe'; base: string | null; clip: Clip; error: string }
  | { status: 'translating'; turnId: string; text: string }
  | { status: 'failed'; stage: 'translate'; turnId: string; text: string; error: string }
  | { status: 'speaking'; turnId: string }
  | { status: 'failed'; stage: 'speak'; turnId: string; error: string }
  | { status: 'done'; turnId: string }

export type TurnEvent =
  | { type: 'record' }
  | { type: 'recordAgain' }
  | { type: 'addMore' }
  | { type: 'stop'; clip: Clip }
  | { type: 'cancel' }
  | { type: 'transcribed'; text: string }
  | { type: 'transcriptionFailed'; error: string }
  | { type: 'retry' }
  | { type: 'edit'; text: string }
  | { type: 'send'; turnId: string }
  | { type: 'translated' }
  | { type: 'translationFailed'; error: string }
  | { type: 'spoken' }
  | { type: 'speechFailed'; error: string }
  | { type: 'retranslate'; turnId: string; text: string }

export const initialTurn: TurnState = { status: 'idle' }

/** Returns the next state, or the same state when the event does not apply. */
export function transition(state: TurnState, event: TurnEvent): TurnState {
  switch (state.status) {
    case 'idle':
    case 'done':
      if (event.type === 'record') return { status: 'recording', base: null }
      if (event.type === 'retranslate') return { status: 'translating', turnId: event.turnId, text: event.text }
      return state

    case 'recording':
      if (event.type === 'stop') return { status: 'transcribing', base: state.base, clip: event.clip }
      if (event.type === 'cancel') return backTo(state.base)
      return state

    case 'transcribing':
      if (event.type === 'transcribed') return { status: 'review', text: appendText(state.base, event.text) }
      if (event.type === 'transcriptionFailed') {
        return { status: 'failed', stage: 'transcribe', base: state.base, clip: state.clip, error: event.error }
      }
      return state

    case 'review':
      if (event.type === 'edit') return { status: 'review', text: event.text }
      if (event.type === 'recordAgain') return { status: 'recording', base: null }
      if (event.type === 'addMore') return { status: 'recording', base: state.text }
      if (event.type === 'send' && state.text.trim()) {
        return { status: 'translating', turnId: event.turnId, text: state.text.trim() }
      }
      return state

    case 'translating':
      if (event.type === 'translated') return { status: 'speaking', turnId: state.turnId }
      if (event.type === 'translationFailed') {
        return { status: 'failed', stage: 'translate', turnId: state.turnId, text: state.text, error: event.error }
      }
      return state

    case 'speaking':
      if (event.type === 'spoken') return { status: 'done', turnId: state.turnId }
      if (event.type === 'speechFailed') return { status: 'failed', stage: 'speak', turnId: state.turnId, error: event.error }
      if (event.type === 'record') return { status: 'recording', base: null }
      return state

    case 'failed':
      // Like done: the translation is shown and the next turn can start.
      if (state.stage === 'speak') {
        if (event.type === 'record') return { status: 'recording', base: null }
        if (event.type === 'retranslate') return { status: 'translating', turnId: event.turnId, text: event.text }
        return state
      }
      if (state.stage === 'translate') {
        if (event.type === 'retry') return { status: 'translating', turnId: state.turnId, text: state.text }
        if (event.type === 'record') return { status: 'recording', base: null }
        if (event.type === 'retranslate') return { status: 'translating', turnId: event.turnId, text: event.text }
        return state
      }
      if (event.type === 'retry') return { status: 'transcribing', base: state.base, clip: state.clip }
      // Re-records the clip that failed; text that was already there is kept.
      if (event.type === 'recordAgain') return { status: 'recording', base: state.base }
      if (event.type === 'cancel') return backTo(state.base)
      return state

    default:
      return state
  }
}

function backTo(base: string | null): TurnState {
  return base === null ? { status: 'idle' } : { status: 'review', text: base }
}

/** Joins the current text and a new transcript with a space. */
export function appendText(base: string | null, addition: string): string {
  return [base?.trim(), addition.trim()].filter(Boolean).join(' ')
}

/** Text the recogniser should treat as context for the clip being transcribed. */
export function hintFor(state: TurnState): string | undefined {
  return state.status === 'transcribing' && state.base?.trim() ? state.base : undefined
}
