import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareConfig } from '../src/config.ts'
import type { CredentialResolver } from '../src/credentials.ts'
import { CloudflareNoAccountError, CloudflareService } from '../src/service.ts'
import type { CloudflareEnvelope } from '../src/types.ts'

const credentials: CredentialResolver = { resolve: () => 'tok' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function ok<T>(result: T, info?: CloudflareEnvelope['result_info']): CloudflareEnvelope<T> {
  return info === undefined
    ? { success: true, errors: [], messages: [], result }
    : { success: true, errors: [], messages: [], result, result_info: info }
}

function build(over: Partial<ReturnType<typeof CloudflareConfig>> = {}, fetchImpl?: (r: Request) => Promise<Response>) {
  const requests: Request[] = []
  const ctx = new Context()
  const config = CloudflareConfig({ baseUrl: 'https://api.test/v4', ...over })
  const service = new CloudflareService(ctx, config, {
    credentials,
    fetch: async (req) => {
      requests.push(req)
      return fetchImpl === undefined ? json(ok(null)) : fetchImpl(req)
    },
  })
  return { service, requests }
}

describe('CloudflareService.listAccounts', () => {
  it('returns every accessible account', async () => {
    const { service } = build({}, async () => json(ok([{ id: 'a1', name: 'One' }])))
    await expect(service.listAccounts()).resolves.toEqual([{ id: 'a1', name: 'One' }])
  })

  it('requests the accounts endpoint with a page size', async () => {
    const { service, requests } = build({}, async () => json(ok([])))
    await service.listAccounts()
    expect(requests[0]!.url).toBe('https://api.test/v4/accounts?per_page=50')
  })

  it('follows the cursor across pages', async () => {
    const pages = [json(ok([{ id: 'a1', name: 'One' }], { cursor: 'c1' })), json(ok([{ id: 'a2', name: 'Two' }]))]
    let i = 0
    const { service } = build({}, async () => pages[i++]!)
    await expect(service.listAccounts()).resolves.toHaveLength(2)
  })
})

describe('CloudflareService.accountId', () => {
  it('prefers the configured account without calling the API', async () => {
    const fetchImpl = vi.fn(async () => json(ok([])))
    const { service } = build({ accountId: 'configured' }, fetchImpl)
    await expect(service.accountId()).resolves.toBe('configured')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('discovers the first account when none is configured', async () => {
    const { service } = build({}, async () => json(ok([{ id: 'found', name: 'F' }, { id: 'other', name: 'O' }])))
    await expect(service.accountId()).resolves.toBe('found')
  })

  it('remembers a discovered account instead of rediscovering it', async () => {
    const fetchImpl = vi.fn(async () => json(ok([{ id: 'found', name: 'F' }])))
    const { service } = build({}, fetchImpl)
    await service.accountId()
    await service.accountId()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fails loud when the token can see no account', async () => {
    const { service } = build({}, async () => json(ok([])))
    await expect(service.accountId()).rejects.toThrow(CloudflareNoAccountError)
  })

  it('explains both the cause and the remedy when no account is available', async () => {
    const { service } = build({}, async () => json(ok([])))
    await expect(service.accountId()).rejects.toMatchObject({
      name: 'CloudflareNoAccountError',
      status: 404,
      message:
        'No Cloudflare account is configured and the token has access to none. ' +
        'Set `accountId` in the plugin config.',
    })
  })
})

describe('CloudflareService scoping', () => {
  it('builds an account scope from the resolved id', async () => {
    const { service } = build({ accountId: 'a9' })
    await expect(service.accountScope()).resolves.toEqual({ kind: 'account', id: 'a9' })
  })

  it('builds an explicit scope of either kind', () => {
    const { service } = build({ accountId: 'a9' })
    expect(service.scope('zone', 'z1')).toEqual({ kind: 'zone', id: 'z1' })
    expect(service.scope('account', 'a1')).toEqual({ kind: 'account', id: 'a1' })
  })

  it('rejects an empty scope id', () => {
    const { service } = build({ accountId: 'a9' })
    expect(() => service.scope('zone', '')).toThrow(TypeError)
  })
})

describe('CloudflareService requests', () => {
  it('prefixes an account-scoped path', async () => {
    const { service, requests } = build({ accountId: 'a9' }, async () => json(ok({ done: true })))
    await service.accountRequest({ method: 'GET', path: '/d1/database' })
    expect(requests[0]!.url).toBe('https://api.test/v4/accounts/a9/d1/database')
  })

  it('returns the unwrapped result of an account request', async () => {
    const { service } = build({ accountId: 'a9' }, async () => json(ok({ done: true })))
    await expect(service.accountRequest({ method: 'GET', path: '/x' })).resolves.toEqual({ done: true })
  })

  it('prefixes an explicitly scoped path', async () => {
    const { service, requests } = build({ accountId: 'a9' }, async () => json(ok(null)))
    await service.scopedRequest({ kind: 'zone', id: 'z2' }, { method: 'GET', path: '/dns_records' })
    expect(requests[0]!.url).toBe('https://api.test/v4/zones/z2/dns_records')
  })

  it('carries method and body through to the request', async () => {
    const { service, requests } = build({ accountId: 'a9' }, async () => json(ok(null)))
    await service.accountRequest({ method: 'POST', path: '/x', body: { a: 1 } })
    expect(requests[0]!.method).toBe('POST')
    await expect(requests[0]!.text()).resolves.toBe('{"a":1}')
  })

  it('exposes the underlying client for callers that need envelopes', () => {
    const { service } = build({ accountId: 'a9' })
    expect(service.client.apiTokenRef).toBe('CLOUDFLARE_API_TOKEN')
  })

  it('wires the configured retry budget through to the client', async () => {
    let calls = 0
    const { service } = build(
      { accountId: 'a9', maxRetries: 2, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
      async () => {
        calls += 1
        return json({ success: false, errors: [], messages: [], result: null }, 500)
      },
    )
    await expect(service.accountRequest({ method: 'GET', path: '/x' })).rejects.toThrow()
    expect(calls).toBe(3)
  })

  it('honours a zero retry budget from config', async () => {
    let calls = 0
    const { service } = build({ accountId: 'a9', maxRetries: 0 }, async () => {
      calls += 1
      return json({ success: false, errors: [], messages: [], result: null }, 500)
    })
    await expect(service.accountRequest({ method: 'GET', path: '/x' })).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('wires the configured page ceiling through to list walks', async () => {
    const { service, requests } = build({ accountId: 'a9', maxPages: 2 }, async () =>
      json(ok([{ id: 'a', name: 'A' }], { cursor: 'always' })),
    )
    await service.listAccounts()
    expect(requests).toHaveLength(2)
  })

  it('exposes the validated config', () => {
    const { service } = build({ accountId: 'a9', maxRetries: 7 })
    expect(service.config.maxRetries).toBe(7)
  })
})

describe('CloudflareService lifecycle', () => {
  it('registers itself on the context under the cloudflare name', () => {
    const ctx = new Context()
    const service = new CloudflareService(ctx, CloudflareConfig({}), { credentials })
    expect(service.name).toBe('cloudflare')
  })

  it('falls back to the global fetch when none is injected', async () => {
    const globalFetch = vi.fn(async () => json(ok({ via: 'global' })))
    vi.stubGlobal('fetch', globalFetch)
    try {
      const ctx = new Context()
      const service = new CloudflareService(ctx, CloudflareConfig({ accountId: 'a1' }), { credentials })
      await expect(service.accountRequest({ method: 'GET', path: '/x' })).resolves.toEqual({ via: 'global' })
      expect(globalFetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
