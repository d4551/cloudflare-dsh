import { describe, expect, it } from 'vitest'
import { requireCredential } from '../src/credentials.ts'
import { CloudflareAuthError } from '../src/errors.ts'

const REF = 'CLOUDFLARE_API_TOKEN'

describe('requireCredential', () => {
  it('returns a resolved value', async () => {
    await expect(requireCredential({ resolve: () => 'tok' }, REF)).resolves.toBe('tok')
  })

  it('awaits an async resolver', async () => {
    await expect(requireCredential({ resolve: async () => 'tok' }, REF)).resolves.toBe('tok')
  })

  it('throws when the credential is unset', async () => {
    await expect(requireCredential({ resolve: () => undefined }, REF)).rejects.toThrow(CloudflareAuthError)
  })

  it('throws when the credential is empty', async () => {
    await expect(requireCredential({ resolve: () => '' }, REF)).rejects.toThrow(CloudflareAuthError)
  })

  it('names the reference but never the value', async () => {
    await expect(requireCredential({ resolve: () => undefined }, REF)).rejects.toThrow(
      `Cloudflare credential ${REF} is not set. Store it with the credentials service or export ${REF}.`,
    )
  })

  it('reports 401 so the retry policy treats it as terminal', async () => {
    await expect(requireCredential({ resolve: () => undefined }, REF)).rejects.toMatchObject({
      status: 401,
      credentialRef: REF,
    })
  })

  it('re-resolves on every call so rotation takes effect without a restart', async () => {
    const values = ['first', 'second']
    let i = 0
    const credentials = { resolve: () => values[i++] }
    await expect(requireCredential(credentials, REF)).resolves.toBe('first')
    await expect(requireCredential(credentials, REF)).resolves.toBe('second')
  })
})
