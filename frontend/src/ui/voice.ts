/** Which person a language belongs to: the owner ("you") or the other person. */
export type Voice = 'you' | 'they'

export const voiceText: Record<Voice, string> = { you: 'text-ink', they: 'text-ochre' }
export const voiceRule: Record<Voice, string> = { you: 'border-l-ink', they: 'border-l-ochre' }
export const voiceDot: Record<Voice, string> = { you: 'bg-ink', they: 'bg-ochre' }
export const voiceChip: Record<Voice, string> = { you: 'bg-ink text-on-ink', they: 'bg-ochre text-on-ochre' }

/** m:ss for the recording timer. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
