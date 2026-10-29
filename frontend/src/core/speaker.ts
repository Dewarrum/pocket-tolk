// Speaks translations: the server's mp3 on one reused <audio> element, or the
// device's own voice through speechSynthesis. Framework-free.
//
// iOS Safari only lets an element play once play() has been called on it
// inside a tap, so `unlock` must run synchronously in the tap handler that
// leads to speech (Send, Retry, Replay); the mp3 arrives seconds later and
// plays on the same, now unlocked, element.

/** BCP 47 tags to look for, best first, where the base subtag is not enough. */
const deviceTags: Record<string, string[]> = {
  'es-419': ['es-419', 'es-MX', 'es-US', 'es'],
  // Never a Cantonese (zh-HK) voice for Mandarin, or the other way round.
  'zh-Hans': ['zh-CN', 'cmn-CN', 'zh-Hans'],
  'zh-Hant': ['zh-TW', 'cmn-TW', 'zh-Hant'],
  yue: ['yue', 'zh-HK'],
  nb: ['nb', 'no', 'nn'],
  fil: ['fil', 'tl'],
  he: ['he', 'iw'],
  id: ['id', 'in'],
}

// Apple lists its novelty voices (Eddy, Grandma, Rocko…) first, named like
// "Eddy (Korean (South Korea))"; the plain voice (Yuna) reads better.
const novelty = (name: string) => /\(.*\(.*\)\)$/.test(name)

/** The device voice for a supported language code, or undefined when it has none. */
export function pickVoice<V extends { lang: string; name?: string; default?: boolean }>(
  voices: readonly V[],
  code: string,
): V | undefined {
  for (const tag of deviceTags[code] ?? [code, code.split('-')[0]]) {
    const want = tag.toLowerCase()
    const matches = voices.filter((v) => {
      const lang = v.lang.replace('_', '-').toLowerCase()
      return lang === want || lang.startsWith(want + '-')
    })
    if (matches.length) return matches.find((v) => v.default) ?? matches.find((v) => !novelty(v.name ?? '')) ?? matches[0]
  }
  return undefined
}

export function createSpeaker() {
  let audio: HTMLAudioElement | undefined
  let deviceUnlocked = false
  /** Ends what is playing now, as cut off. */
  let current: (() => void) | undefined

  const synth = () => (typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis)

  /**
   * Runs one playback. `start` begins it, calls `end` when it finishes or
   * fails, and returns how to halt it. Resolves when it ends or is cut off
   * (stop, abort, or a newer playback); rejects only when it cannot play.
   */
  function run(signal: AbortSignal | undefined, start: (end: (err?: unknown) => void) => () => void): Promise<void> {
    current?.()
    return new Promise<void>((resolve, reject) => {
      let halt = () => {}
      const end = (err?: unknown) => {
        if (current !== end) return
        current = undefined
        signal?.removeEventListener('abort', onAbort)
        halt()
        if (err === undefined) resolve()
        else reject(err)
      }
      const onAbort = () => end()
      current = end
      if (signal?.aborted) return end()
      signal?.addEventListener('abort', onAbort)
      try {
        halt = start(end)
      } catch (err) {
        end(err)
      }
    })
  }

  return {
    /** Call synchronously inside the tap that leads to speech. Stops what is playing. */
    unlock() {
      current?.()
      audio ??= new Audio()
      audio.src = silence()
      audio.play().catch(() => {})
      const device = synth()
      if (device && !deviceUnlocked) {
        deviceUnlocked = true
        device.speak(new SpeechSynthesisUtterance(''))
      }
    },

    play(mp3: Blob, signal?: AbortSignal): Promise<void> {
      return run(signal, (end) => {
        const el = (audio ??= new Audio())
        const src = URL.createObjectURL(mp3)
        el.onended = () => end()
        el.onerror = () => end(new Error('The audio could not be played.'))
        el.src = src
        el.play().catch(end)
        return () => {
          el.onended = el.onerror = null
          el.pause()
          URL.revokeObjectURL(src)
        }
      })
    },

    /** The device's voice for a language code; waits briefly for the list to load. */
    async deviceVoice(code: string): Promise<SpeechSynthesisVoice | undefined> {
      const device = synth()
      if (!device) return undefined
      if (!device.getVoices().length) {
        await new Promise<void>((resolve) => {
          device.addEventListener('voiceschanged', () => resolve(), { once: true })
          setTimeout(resolve, 1000)
        })
      }
      return pickVoice(device.getVoices(), code)
    },

    speakOnDevice(text: string, voice: SpeechSynthesisVoice, signal?: AbortSignal): Promise<void> {
      return run(signal, (end) => {
        const device = speechSynthesis
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.voice = voice
        utterance.lang = voice.lang
        utterance.onend = () => end()
        utterance.onerror = (e) => end(e.error === 'interrupted' || e.error === 'canceled' ? undefined : new Error(e.error))
        device.speak(utterance)
        return () => {
          utterance.onend = utterance.onerror = null
          device.cancel()
        }
      })
    },

    stop() {
      current?.()
    },
  }
}

export type Speaker = ReturnType<typeof createSpeaker>

let silenceUrl: string | undefined

/** 0.1 s of silent 16-bit mono WAV, as a data URL. */
function silence(): string {
  if (silenceUrl) return silenceUrl
  const rate = 8000
  const dataBytes = (rate / 10) * 2
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  // The samples are already zero: silence.
  silenceUrl = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...new Uint8Array(view.buffer)))
  return silenceUrl
}
