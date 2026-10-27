import { describe, expect, it } from 'vitest'
import type { Clip } from './recorder'
import { hintFor, initialTurn, transition, type TurnEvent, type TurnState } from './turnMachine'

const clip: Clip = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 1000 }

const run = (state: TurnState, ...events: TurnEvent[]) => events.reduce(transition, state)

describe('turnMachine', () => {
  it('records, transcribes and lands in review', () => {
    const state = run(initialTurn, { type: 'record' }, { type: 'stop', clip }, { type: 'transcribed', text: ' Привет ' })
    expect(state).toEqual({ status: 'review', text: 'Привет' })
  })

  it('Add more appends the new transcript to the edited text and hints with it', () => {
    let state = run({ status: 'review', text: 'Где аптека' }, { type: 'edit', text: 'Где здесь аптека?' }, { type: 'addMore' })
    expect(state).toEqual({ status: 'recording', base: 'Где здесь аптека?' })

    state = transition(state, { type: 'stop', clip })
    expect(hintFor(state)).toBe('Где здесь аптека?')

    state = transition(state, { type: 'transcribed', text: 'И когда она открывается?' })
    expect(state).toEqual({ status: 'review', text: 'Где здесь аптека? И когда она открывается?' })
  })

  it('Record again discards the text', () => {
    const state = run({ status: 'review', text: 'old' }, { type: 'recordAgain' }, { type: 'stop', clip }, { type: 'transcribed', text: 'new' })
    expect(state).toEqual({ status: 'review', text: 'new' })
  })

  it('a failed transcription keeps the text and the clip for retry, record again or going back', () => {
    const failed = run({ status: 'review', text: 'kept' }, { type: 'addMore' }, { type: 'stop', clip }, { type: 'transcriptionFailed', error: 'down' })
    expect(failed).toEqual({ status: 'failed', stage: 'transcribe', base: 'kept', clip, error: 'down' })

    expect(transition(failed, { type: 'retry' })).toEqual({ status: 'transcribing', base: 'kept', clip })
    expect(transition(failed, { type: 'recordAgain' })).toEqual({ status: 'recording', base: 'kept' })
    expect(transition(failed, { type: 'cancel' })).toEqual({ status: 'review', text: 'kept' })
  })

  it('ignores events that do not apply', () => {
    const transcribing: TurnState = { status: 'transcribing', base: null, clip }
    expect(transition(initialTurn, { type: 'stop', clip })).toBe(initialTurn)
    expect(transition(transcribing, { type: 'record' })).toBe(transcribing)
  })
})
