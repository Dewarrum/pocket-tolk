import { describe, expect, it } from 'vitest'
import { ApiError, createApiClient } from './api'

function clientReturning(respond: () => Promise<Response>) {
  const calls: Request[] = []
  const api = createApiClient({
    getToken: () => 'secret',
    fetch: (input, init) => {
      calls.push(new Request(new URL(String(input), 'http://test'), init))
      return respond()
    },
  })
  return { api, calls }
}

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

describe('api client', () => {
  it('sends the bearer token and the clip as multipart', async () => {
    const { api, calls } = clientReturning(() => json(200, { text: '안녕', model: 'm', latencyMs: 5 }))
    const audio = new Blob(['opus'], { type: 'audio/webm;codecs=opus' })

    await expect(api.transcribe({ audio, languages: ['ko', 'ru'], hint: 'context' })).resolves.toEqual({
      text: '안녕', model: 'm', latencyMs: 5,
    })
    const form = await calls[0].formData()
    expect(calls[0].headers.get('Authorization')).toBe('Bearer secret')
    expect((form.get('audio') as File).name).toBe('clip.webm')
    expect([form.get('languages'), form.get('hint')]).toEqual(['ko,ru', 'context'])
  })

  it('maps the error envelope to ApiError', async () => {
    const { api } = clientReturning(() => json(502, { error: { code: 'provider_error', message: 'timed out' } }))
    await expect(api.languages()).rejects.toEqual(new ApiError(502, 'provider_error', 'timed out'))
  })

  it('maps responses without an envelope and network failures', async () => {
    const proxyPage = clientReturning(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })))
    await expect(proxyPage.api.languages()).rejects.toMatchObject({ status: 502, code: 'http_error' })

    const offline = clientReturning(() => Promise.reject(new TypeError('Failed to fetch')))
    await expect(offline.api.languages()).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })
})
