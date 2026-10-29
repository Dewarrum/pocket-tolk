import { expect, it } from 'vitest'
import { pickVoice } from './speaker'

it('picks the device voice by language: never Cantonese for Mandarin, plain before novelty', () => {
  const voices = [
    { lang: 'zh-HK' }, { lang: 'es-ES' }, { lang: 'es-MX' }, { lang: 'nb_NO' },
    { lang: 'ko-KR', name: 'Eddy (Korean (South Korea))' }, { lang: 'ko-KR', name: 'Yuna' },
  ]
  expect(pickVoice(voices, 'zh-Hans')).toBeUndefined()
  expect(pickVoice(voices, 'yue')?.lang).toBe('zh-HK')
  expect(pickVoice(voices, 'es-419')?.lang).toBe('es-MX')
  expect(pickVoice(voices, 'ko')?.name).toBe('Yuna')
  expect(pickVoice(voices, 'nb')?.lang).toBe('nb_NO')
})
