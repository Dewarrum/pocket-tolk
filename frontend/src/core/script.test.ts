import { expect, it } from 'vitest'
import { guessLanguage } from './script'

it('guesses the session language from the script, and only when it is unambiguous', () => {
  expect(guessLanguage('클라우드 기계 학습을 사용하면', ['ru', 'ko'])).toBe('ko')
  expect(guessLanguage('С помощью Cloud Machine Learning', ['ru', 'ko'])).toBe('ru')
  expect(guessLanguage('東京に行きます', ['zh-Hans', 'ja'])).toBe('ja')
  expect(guessLanguage('Hola, ¿dónde está?', ['es-ES', 'fr'])).toBeUndefined()
})
