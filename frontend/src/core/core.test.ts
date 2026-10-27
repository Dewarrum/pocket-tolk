import { expect, it } from 'vitest'

it('core imports nothing from React or the UI, so it can move to a native shell', () => {
  const sources = import.meta.glob<string>(['./*.ts', '!./*.test.ts'], { query: '?raw', import: 'default', eager: true })
  expect(Object.keys(sources).length).toBeGreaterThan(4)
  for (const [file, source] of Object.entries(sources)) {
    expect(source, file).not.toMatch(/['"](react|react-dom|motion)(\/[^'"]*)?['"]|['"]@\/ui\//)
  }
})
