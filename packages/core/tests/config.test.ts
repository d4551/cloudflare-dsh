import { describe, expect, it } from 'vitest'
import { CloudflareConfig } from '../src/config.ts'

/**
 * The messages a Standard Schema result reports, read the way cordis reads it.
 *
 * `resolveConfig` in cordis calls this same `~standard` entry point on a loaded
 * patch, rejects a Promise with a TypeError, treats falsy `issues` as success,
 * and throws a ValidationError carrying the issues otherwise. Reading the
 * result here through that contract is what makes the assertion below one about
 * the schema cordis actually validates with rather than about a private helper
 * beside it.
 */
function issuesOf(
  validated: ReturnType<(typeof CloudflareConfig)['~standard']['validate']>,
): readonly string[] {
  if (validated instanceof Promise) throw new TypeError('async config validation is not supported')
  return (validated.issues ?? []).map((issue) => issue.message)
}

describe('CloudflareConfig', () => {
  it('implements Standard Schema, as Cordis requires of a Config export', () => {
    expect('~standard' in CloudflareConfig).toBe(true)
  })

  it('validates synchronously, which is the only result cordis accepts', () => {
    // The entry point is typed as `Result | Promise<Result>`; cordis throws a
    // TypeError on the promise half, so a schema that validated asynchronously
    // would fail every load rather than validating something.
    expect(CloudflareConfig['~standard'].validate({})).not.toBeInstanceOf(Promise)
  })

  it('applies defaults for every field', () => {
    expect(CloudflareConfig({})).toEqual({
      apiTokenRef: 'CLOUDFLARE_API_TOKEN',
      accountId: '',
      baseUrl: 'https://api.cloudflare.com/client/v4',
      requestTimeoutMs: 30_000,
      maxRetries: 3,
      retryBaseDelayMs: 250,
      retryMaxDelayMs: 10_000,
      maxPages: 100,
    })
  })

  it.each([
    ['apiTokenRef', 'CF_TOKEN'],
    ['accountId', 'acct-1'],
    ['baseUrl', 'https://proxy.test/v4'],
  ])('accepts an override for %s', (key, value) => {
    expect(CloudflareConfig({ [key]: value })).toMatchObject({ [key]: value })
  })

  it.each([
    ['requestTimeoutMs', 1000],
    ['maxRetries', 0],
    ['retryBaseDelayMs', 50],
    ['retryMaxDelayMs', 500],
    ['maxPages', 5],
  ])('accepts a numeric override for %s', (key, value) => {
    expect(CloudflareConfig({ [key]: value })).toMatchObject({ [key]: value })
  })

  it('rejects a value of the wrong type rather than coercing it', () => {
    // cordis.yml is untyped at runtime, so the schema has to reject this even
    // though TypeScript would catch it at a typed call site. The Standard Schema
    // entry point is the one cordis validates a loaded patch through, and it
    // takes an untyped value by contract — which is what lets this assert the
    // rejection without an assertion of its own about the input's type.
    expect(issuesOf(CloudflareConfig['~standard'].validate({ maxRetries: 'lots' }))).toEqual([
      '$.maxRetries expected number but got lots',
    ])
  })

  it('reports the same rejection for a field no scalar is valid for', () => {
    // One field is not the rule: a schema that rejected only `maxRetries` and
    // coerced or ignored everything else would pass the case above. Every
    // numeric field is checked, through the entry point cordis uses.
    for (const field of ['requestTimeoutMs', 'retryBaseDelayMs', 'retryMaxDelayMs', 'maxPages']) {
      expect(issuesOf(CloudflareConfig['~standard'].validate({ [field]: [] })), field).not.toEqual([])
    }
  })
})
