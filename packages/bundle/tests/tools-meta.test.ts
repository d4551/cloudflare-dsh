import { describe, expect, it } from 'vitest'
import { json } from '../src/tools/_shared/render.ts'
import * as metaTools from '../src/tools/meta.ts'
import { envelope, makeHarness } from './harness.ts'

/** Build a harness with the meta plugin at a given configuration. */
function harness(config: Partial<metaTools.MetaConfig>, fetchImpl = async () => envelope(null)) {
  const validated = metaTools.Config(config)
  return makeHarness({ apply: (ctx) => metaTools.apply(ctx, validated) }, fetchImpl)
}

describe('meta plugin shape', () => {
  it('declares its name and injections', () => {
    expect(metaTools.name).toBe('cloudflare-tools-meta')
    expect(metaTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('exports a Standard Schema Config', () => {
    expect('~standard' in metaTools.Config).toBe(true)
  })

  it('defaults to refusing mutations and to an empty denylist', () => {
    expect(metaTools.Config({})).toStrictEqual({
      allowMutations: false,
      denyPathPrefixes: [],
    })
  })

  it('accepts overrides', () => {
    expect(metaTools.Config({ allowMutations: true, denyPathPrefixes: ['/user'] })).toStrictEqual({
      allowMutations: true,
      denyPathPrefixes: ['/user'],
    })
  })

  it('registers both meta tools', () => {
    expect([...harness({}).tools.keys()].toSorted()).toEqual(['cloudflare_account_list', 'cloudflare_api'])
  })
})

describe('cloudflare_account_list', () => {
  it('returns the accessible accounts', async () => {
    const h = harness({}, async () => envelope([{ id: 'a1', name: 'One' }]))
    await expect(h.run('cloudflare_account_list', {})).resolves.toEqual({
      accounts: [{ id: 'a1', name: 'One' }],
      truncated: false,
    })
  })

  it('renders an account count', () => {
    const h = harness({})
    expect(h.tool('cloudflare_account_list').output.render({}, { accounts: [{ id: 'a' }] })).toEqual([
      { type: 'text', text: expect.stringContaining('1 account') },
    ])
  })

  it('is concurrency safe', () => {
    expect(harness({}).tool('cloudflare_account_list').isConcurrencySafe?.({})).toBe(true)
  })
})

describe('cloudflare_api', () => {
  it('performs a read and returns the unwrapped result', async () => {
    const h = harness({}, async () => envelope({ configs: [] }))
    await expect(
      h.run('cloudflare_api', {
        method: 'GET',
        path: '/accounts/a1/hyperdrive/configs',
      }),
    ).resolves.toEqual({
      result: { configs: [] },
    })
  })

  it('issues the request at the api root, unscoped', async () => {
    const h = harness({}, async () => envelope(null))
    await h.run('cloudflare_api', { method: 'GET', path: '/zones' })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/zones')
  })

  it('passes query parameters through', async () => {
    const h = harness({}, async () => envelope(null))
    await h.run('cloudflare_api', {
      method: 'GET',
      path: '/zones',
      query: { per_page: '5' },
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/zones?per_page=5')
  })

  it('refuses a mutating method while read-only, without issuing a request', async () => {
    const h = harness({}, async () => envelope(null))
    await expect(h.run('cloudflare_api', { method: 'DELETE', path: '/zones/z1' })).rejects.toThrow(
      /configured read-only/,
    )
    expect(h.requests).toHaveLength(0)
  })

  it('permits a mutating method once configured', async () => {
    const h = harness({ allowMutations: true }, async () => envelope({ deleted: true }))
    await expect(h.run('cloudflare_api', { method: 'DELETE', path: '/zones/z1' })).resolves.toEqual({
      result: { deleted: true },
    })
    expect(h.requests[0]!.method).toBe('DELETE')
  })

  it('sends a body on a permitted write', async () => {
    const h = harness({ allowMutations: true }, async () => envelope(null))
    await h.run('cloudflare_api', {
      method: 'POST',
      path: '/zones',
      body: { name: 'x.test' },
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"name":"x.test"}')
  })

  it('refuses a denylisted path even when mutations are allowed', async () => {
    const h = harness({ allowMutations: true, denyPathPrefixes: ['/user'] })
    await expect(h.run('cloudflare_api', { method: 'GET', path: '/user/tokens' })).rejects.toThrow(/denylist/)
    expect(h.requests).toHaveLength(0)
  })

  it('cannot be redirected to another host', async () => {
    const h = harness({})
    await expect(h.run('cloudflare_api', { method: 'GET', path: 'https://evil.test/x' })).rejects.toThrow(
      /must start with "\/"/,
    )
    expect(h.requests).toHaveLength(0)
  })

  it('cannot traverse out of the api root', async () => {
    const h = harness({})
    await expect(h.run('cloudflare_api', { method: 'GET', path: '/a/../../x' })).rejects.toThrow(
      /must not contain "\.\."/,
    )
    expect(h.requests).toHaveLength(0)
  })

  it('rejects a method outside the advertised set', async () => {
    const h = harness({ allowMutations: true })
    await expect(h.run('cloudflare_api', { method: 'TRACE', path: '/zones' })).rejects.toThrow(/method/i)
    expect(h.requests).toHaveLength(0)
  })

  it('cannot reach another host through an encoded denylist bypass', async () => {
    const h = harness({ denyPathPrefixes: ['/accounts/x/tokens'] })
    await expect(h.run('cloudflare_api', { method: 'GET', path: '/accounts/x/%74okens' })).rejects.toThrow(/denylist/)
    expect(h.requests).toHaveLength(0)
  })

  it('blocks a descendant of a denylisted prefix reached by encoding', async () => {
    // The prefix is a *prefix*, not the whole path: the encoded spelling has to
    // be blocked for everything under it, not only for an exact match.
    const h = harness({ denyPathPrefixes: ['/accounts/x/tokens'] })
    await expect(
      h.run('cloudflare_api', {
        method: 'GET',
        path: '/accounts/x/%74okens/verify',
      }),
    ).rejects.toThrow('path /accounts/x/%74okens/verify is blocked by the configured denylist (/accounts/x/tokens)')
    expect(h.requests).toHaveLength(0)
  })

  it('blocks a descendant of a denylisted prefix that is itself written encoded', async () => {
    // Mirror of the case above: here the literal spelling matches and the
    // decoded one does not, so the raw comparison is the load-bearing one.
    const h = harness({ denyPathPrefixes: ['/accounts/x/%74okens'] })
    await expect(
      h.run('cloudflare_api', {
        method: 'GET',
        path: '/accounts/x/%74okens/verify',
      }),
    ).rejects.toThrow(/denylist/)
    expect(h.requests).toHaveLength(0)
  })

  it('renders the result as JSON', () => {
    const h = harness({})
    expect(h.tool('cloudflare_api').output.render({ method: 'GET', path: '/x' }, { result: { a: 1 } })).toEqual(json({ a: 1 }))
  })

  it('is not marked concurrency safe, since it can be configured to write', () => {
    expect(harness({}).tool('cloudflare_api').isConcurrencySafe).toBeUndefined()
  })
})
