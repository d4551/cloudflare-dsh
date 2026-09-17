import { describe, expect, it } from 'vitest'
import { TRANSPORT_FAILURE_STATUS, readEnvelope, statusOfError } from '../src/client.ts'
import { CloudflareAuthError, CloudflareError, isRetryableStatus } from '../src/errors.ts'
import { json, makeClient, ok, REF } from './support/client-fixture.ts'

describe('statusOfError', () => {
  it('reads the status from a Cloudflare error', () => {
    expect(statusOfError(new CloudflareError('x', 503))).toBe(503)
  })

  it('treats a transport failure as retryable', () => {
    // `fetch` reports a reset connection or a DNS failure as a bare TypeError
    // with no status. It is the commonest transient failure there is, and it
    // was previously classified as permanent.
    expect(statusOfError(new TypeError('fetch failed'))).toBe(TRANSPORT_FAILURE_STATUS)
    expect(isRetryableStatus(TRANSPORT_FAILURE_STATUS)).toBe(true)
  })

  it('does not retry an abort, which is the caller deciding to stop', () => {
    // Aborting a fetch throws a DOMException, not a TypeError.
    expect(statusOfError(new DOMException('aborted', 'AbortError'))).toBe(0)
  })

  it('reports zero for a DOMException that is neither a timeout nor an abort', () => {
    expect(statusOfError(new DOMException('nope', 'NotSupportedError'))).toBe(0)
  })
})

describe('requestText failure classification', () => {
  it('uses the Cloudflare code from an error body, not just the status', async () => {
    // 10000 is unauthorized regardless of the status class, and requestText
    // previously threw the body away before classifying.
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'nope' }], messages: [], result: null },
        {
          status: 500,
        },
      ),
    )
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      CloudflareAuthError,
    )
  })

  it('carries the credential reference and the envelope code', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'nope' }], messages: [], result: null },
        {
          status: 403,
        },
      ),
    )
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      credentialRef: REF,
      message: '[10000] nope',
    })
  })

  it('still classifies by status when the error body is not an envelope, and keeps the body', async () => {
    const { client } = makeClient(async () => new Response('<html>gateway error</html>', { status: 404 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareNotFoundError',
      message: 'HTTP 404 without a Cloudflare envelope: <html>gateway error</html>',
    })
  })
})

describe('readEnvelope', () => {
  it('parses a JSON envelope', async () => {
    await expect(readEnvelope(json(ok({ a: 1 })))).resolves.toEqual({
      ok: true,
      envelope: ok({ a: 1 }),
    })
  })

  it('reports failure for an empty body', async () => {
    await expect(readEnvelope(new Response(null, { status: 204 }))).resolves.toEqual({ ok: false, body: '' })
  })

  it('reports failure for a non-JSON body rather than throwing SyntaxError', async () => {
    await expect(readEnvelope(new Response('<html>502</html>', { status: 502 }))).resolves.toEqual({
      ok: false,
      body: '<html>502</html>',
    })
  })
})
