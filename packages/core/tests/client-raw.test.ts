import { describe, expect, it } from 'vitest'
import { CloudflareAuthError, CloudflareError, CloudflareNotFoundError } from '../src/errors.ts'
import { json, makeClient, ok, REF } from './support/client-fixture.ts'

describe('CloudflareClient.requestText', () => {
  it('returns the raw body for endpoints that do not use an envelope', async () => {
    const { client } = makeClient(async () => new Response('stored-value', { status: 200 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).resolves.toBe('stored-value')
  })

  it('returns an empty body unchanged', async () => {
    const { client } = makeClient(async () => new Response('', { status: 200 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).resolves.toBe('')
  })

  it('classifies a failure by status', async () => {
    const { client } = makeClient(async () => new Response('nope', { status: 404 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareNotFoundError)
  })

  it('carries the retry hint on a rate-limited raw response', async () => {
    const { client } = makeClient(
      async () => new Response('slow', { status: 429, headers: { 'retry-after': '4' } }),
    )
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      retryAfterMs: 4000,
    })
  })

  it('sends the resolved bearer token', async () => {
    const { client, requests } = makeClient(async () => new Response('v', { status: 200 }))
    await client.requestText({ method: 'GET', path: '/x' })
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok')
  })

  it('fails loud when the credential is missing', async () => {
    const { client } = makeClient(async () => new Response('v'), {
      credentials: { resolve: () => undefined },
    })
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })
})

describe('CloudflareClient.requestEnvelope', () => {
  it('returns the whole envelope including result_info', async () => {
    const { client } = makeClient(async () => json(ok([1, 2], { cursor: 'c1' })))
    const env = await client.requestEnvelope({ method: 'GET', path: '/x' })
    expect(env.result_info).toEqual({ cursor: 'c1' })
  })

  it('throws on an error envelope', async () => {
    const { client } = makeClient(async () =>
      json(
        {
          success: false,
          errors: [{ code: 9, message: 'nope' }],
          messages: [],
          result: null,
        },
        { status: 400 },
      ),
    )
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow('[9] nope')
  })

  it('throws when the body is not an envelope', async () => {
    const { client } = makeClient(async () => new Response('nope', { status: 500 }))
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
  })

  it('fails loud when the credential is missing', async () => {
    const { client } = makeClient(async () => json(ok(null)), {
      credentials: { resolve: () => undefined },
    })
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })
})

describe('CloudflareClient.requestBytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  it('returns the bytes and the media type the server declared', async () => {
    const { client } = makeClient(
      async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    await expect(client.requestBytes({ method: 'POST', path: '/x', accept: 'image/png' })).resolves.toEqual({
      bytes: png,
      contentType: 'image/png',
    })
  })

  it('reports a missing content type as null rather than guessing one', async () => {
    const { client } = makeClient(async () => new Response(png, { status: 200 }))
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).resolves.toMatchObject({
      contentType: null,
    })
  })

  it('sends the accept type the spec names', async () => {
    const { client, requests } = makeClient(async () => new Response(png, { status: 200 }))
    await client.requestBytes({ method: 'POST', path: '/x', accept: 'image/jpeg' })
    expect(requests[0]!.headers.get('accept')).toBe('image/jpeg')
  })

  it('classifies a failure from the envelope code when the error body carries one', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'nope' }], messages: [], result: null },
        {
          status: 500,
        },
      ),
    )
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareAuthError',
      credentialRef: REF,
      message: '[10000] nope',
    })
  })

  it('classifies a failure by status and keeps a body that is not an envelope', async () => {
    const { client } = makeClient(async () => new Response('<html>gateway error</html>', { status: 404 }))
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareNotFoundError',
      message: 'HTTP 404 without a Cloudflare envelope: <html>gateway error</html>',
    })
  })

  it('carries the retry hint on a rate-limited response', async () => {
    const { client } = makeClient(
      async () => new Response('slow', { status: 429, headers: { 'retry-after': '4' } }),
    )
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareRateLimitError',
      retryAfterMs: 4000,
    })
  })

  it('retries a transient failure like every other request', async () => {
    let call = 0
    const { client } = makeClient(async () => {
      call += 1
      if (call === 1) return new Response('busy', { status: 503 })
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).resolves.toMatchObject({ bytes: png })
    expect(call).toBe(2)
  })
})
