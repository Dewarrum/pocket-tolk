// Guesses which session language a text is in from its writing system, so the
// text can carry a `lang` attribute (Han glyph variants, fonts, hyphenation).
// Framework-free.

const latin = new Set([
  'en', 'es-ES', 'es-419', 'fr', 'de', 'it', 'pt-BR', 'pt-PT', 'vi', 'tr', 'pl', 'cs', 'nl', 'sv',
  'nb', 'da', 'fi', 'hu', 'ro', 'id', 'ms', 'fil',
])

// Ordered: a Korean or Russian sentence may contain Latin words, Japanese contains Han.
const scripts: Array<[RegExp, (code: string) => boolean]> = [
  [/\p{Script=Hangul}/u, (c) => c === 'ko'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, (c) => c === 'ja'],
  [/\p{Script=Han}/u, (c) => c.startsWith('zh') || c === 'yue'],
  [/\p{Script=Cyrillic}/u, (c) => c === 'ru' || c === 'uk'],
  [/\p{Script=Greek}/u, (c) => c === 'el'],
  [/\p{Script=Arabic}/u, (c) => c === 'ar'],
  [/\p{Script=Hebrew}/u, (c) => c === 'he'],
  [/\p{Script=Thai}/u, (c) => c === 'th'],
  [/\p{Script=Devanagari}/u, (c) => c === 'hi'],
  [/\p{Script=Latin}/u, (c) => latin.has(c)],
]

/** The one language of `pair` the text's script points to, or undefined when unclear. */
export function guessLanguage(text: string, pair: readonly string[]): string | undefined {
  for (const [pattern, fits] of scripts) {
    if (!pattern.test(text)) continue
    const candidates = pair.filter(fits)
    if (candidates.length === 1) return candidates[0]
    if (candidates.length > 1) return undefined
  }
  return undefined
}
