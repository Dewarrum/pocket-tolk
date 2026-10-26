// The life of one turn, as pure functions. Framework-free.
//
// idle → recording → transcribing → review
// review → recording(append) → transcribing(append) → review
// transcribing → failed(transcribe) → retry | record again | back to the text
//
// `base` is the text a new clip will be appended to (Add more); null for a fresh clip.

import type { Clip } from './recorder'

export type TurnState =
  | { status: 'idle' }
  | { status: 'recording'; base: string | null }
  | { status: 'transcribing'; base: string | null; clip: Clip }
  | { status: 'review'; text: string }
  | { status: 'failed'; stage: 'transcribe'; base: string | null; clip: Clip; error: string }
  // Declared for the next slices; nothing produces them yet.
  | { status: 'translating'; text: string }
  | { status: 'speaking'; text: string }
  | { status: 'done'; text: string }

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

export const initialTurn: TurnState = { status: 'idle' }

/** Returns the next state, or the same state when the event does not apply. */
export function transition(state: TurnState, event: TurnEvent): TurnState {
  switch (state.status) {
    case 'idle':
      return event.type === 'record' ? { status: 'recording', base: null } : state

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
      return state

    case 'failed':
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
