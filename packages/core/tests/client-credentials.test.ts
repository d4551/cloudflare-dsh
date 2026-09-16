import { describe, expect, it } from 'vitest'
import { CloudflareAuthError } from '../src/errors.ts'
import { json, makeClient, ok } from './support/client-fixture.ts'

describe('CloudflareClient.resolveToken', () => {
  it('returns the resolved token for callers on other Cloudflare hosts', async () => {
    const { client } = makeClient(async () => json(ok(null)))
    await expect(client.resolveToken()).resolves.toBe('tok')
  })

  it('resolves per call so a rotated credential is picked up', async () => {
    const values = ['first', 'second']
    let i = 0
    const { client } = makeClient(async () => json(ok(null)), {
      credentials: { resolve: () => values[i++] },
    })
    await expect(client.resolveToken()).resolves.toBe('first')
    await expect(client.resolveToken()).resolves.toBe('second')
  })

  it('fails loud when the credential is missing', async () => {
    const { client } = makeClient(async () => json(ok(null)), {
      credentials: { resolve: () => undefined },
    })
    await expect(client.resolveToken()).rejects.toThrow(CloudflareAuthError)
  })
})
