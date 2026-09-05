import { describe, expect, it } from 'vitest'
import { CloudflareConfig } from '../src/config.ts'
import type { CloudflareConfig as CloudflareConfigType } from '../src/config.ts'

describe('CloudflareConfig', () => {
  it('implements Standard Schema, as Cordis requires of a Config export', () => {
    expect('~standard' in CloudflareConfig).toBe(true)
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
    // though TypeScript would catch it at a typed call site.
    const fromYaml: unknown = { maxRetries: 'lots' }
    expect(() => CloudflareConfig(fromYaml as Partial<CloudflareConfigType>)).toThrow(
      '$.maxRetries expected number but got lots',
    )
  })
})
