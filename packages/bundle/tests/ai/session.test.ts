/**
 * The per-session cost tool and the pure session-log arithmetic it stands on:
 * filtering, summation, refusal of corrupt fields, and the projection the
 * client's usage chip renders.
 */
import { describe, expect, it } from 'vitest'
import * as aiTools from '../../src/tools/ai/index.ts'
import { sessionOf, summariseSessionLogs } from '../../src/tools/ai/index.ts'
import { envelope, makeHarness } from '../harness.ts'

describe('summariseSessionLogs', () => {
  it('reports zeros for an empty session', () => {
    expect(aiTools.summariseSessionLogs([])).toStrictEqual({
      requests: 0,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
    })
  })

  it('sums cost and tokens across entries', () => {
    expect(
      aiTools.summariseSessionLogs([
        { cost: 0.5, tokens_in: 10, tokens_out: 20, cached: false },
        { cost: 1.5, tokens_in: 5, tokens_out: 1, cached: true },
      ]),
    ).toStrictEqual({
      requests: 2,
      cost: 2,
      tokensIn: 15,
      tokensOut: 21,
      cached: 1,
    })
  })

  it('treats missing numeric fields as zero', () => {
    expect(aiTools.summariseSessionLogs([{}])).toStrictEqual({
      requests: 1,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
    })
  })

  it('counts only entries explicitly marked cached', () => {
    expect(aiTools.summariseSessionLogs([{ cached: false }, {}, { cached: true }]).cached).toBe(1)
  })
})

/** A log row carrying the metadata the gateway records. */
function row(sessionId: string, rest: Record<string, string | number | boolean> = {}): Record<string, string | number | boolean> {
  return { metadata: JSON.stringify({ sessionId }), ...rest }
}

describe('cloudflare_aigateway_session_cost', () => {
  it('summarises the logs for one session', async () => {
    const h = makeHarness(aiTools, async () =>
      envelope([
        row('s1', { cost: 1, tokens_in: 2, tokens_out: 3, cached: true }),
        row('s1', { cost: 2, tokens_in: 1, tokens_out: 1 }),
      ]),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).resolves.toEqual({
      requests: 2,
      cost: 3,
      tokensIn: 3,
      tokensOut: 4,
      cached: 1,
      scanned: 2,
      pages: 1,
      truncated: false,
    })
  })

  it('counts only rows whose metadata really carries this session', async () => {
    // The load-bearing assertion. Cloudflare does not document how positional
    // filter repeats are paired, so a filter the server ignores would return
    // every session's logs — and one session would be billed another's cost.
    const h = makeHarness(aiTools, async () =>
      envelope([row('s1', { cost: 1 }), row('other-session', { cost: 99 }), { cost: 50 }]),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).resolves.toMatchObject({ requests: 1, cost: 1, scanned: 3 })
  })

  it('rejects a cost the API returned as a string rather than concatenating it', async () => {
    // `cost += "0.004"` turns the running total into a string.
    const h = makeHarness(aiTools, async () => envelope([row('s1', { cost: '0.004' })]))
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).rejects.toThrow(
      'gateway log field cost must be a number, got string ("0.004"). Summing it would produce a total that is silently wrong.',
    )
  })

  it('filters the gateway logs with the two-clause metadata form', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', {
      gatewayId: 'gw1',
      sessionId: 's1',
    })
    const url = decodeURIComponent(h.requests[0]!.url)
    expect(url).toContain('filters.key=metadata.key&filters.operator=eq&filters.value=sessionId')
    expect(url).toContain('filters.key=metadata.value&filters.operator=eq&filters.value=s1')
  })

  it('scans at the endpoint maximum by default', async () => {
    // The old default was 100, above the documented maximum of 50, so the
    // request was invalid before any filtering question arose.
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', {
      gatewayId: 'gw1',
      sessionId: 's1',
    })
    expect(h.requests[0]!.url).toContain('per_page=50')
  })

  it('refuses a scan size the endpoint will not serve', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await expect(
      h.run('cloudflare_aigateway_session_cost', {
        gatewayId: 'gw1',
        sessionId: 's1',
        perPage: 100,
      }),
    ).rejects.toThrow(/perPage must be between/)
    expect(h.requests).toHaveLength(0)
  })

  it('says so in the rendered summary when the scan was cut short', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_aigateway_session_cost',
        { gatewayId: 'g', sessionId: 's1' },
        { requests: 1, cost: 1, tokensIn: 0, tokensOut: 0, cached: 0, scanned: 1, pages: 1, truncated: true },
      ),
    ).toEqual([{ type: 'text', text: expect.stringContaining('partial') }])
  })

  it('reports a scan the page ceiling cut short', async () => {
    const h = makeHarness(aiTools, async () =>
      envelope([{ metadata: JSON.stringify({ sessionId: 's1' }), cost: 1 }], {
        page: 1,
        per_page: 1,
        total_count: 999,
      }),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', {
        gatewayId: 'gw1',
        sessionId: 's1',
      }),
    ).resolves.toMatchObject({ truncated: true })
  })

  it('honours an explicit scan size', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', {
      gatewayId: 'gw1',
      sessionId: 's1',
      perPage: 7,
    })
    expect(h.requests[0]!.url).toContain('per_page=7')
  })

  it('renders a one-line session summary', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_aigateway_session_cost',
        { gatewayId: 'g', sessionId: 's1' },
        {
          requests: 3,
          cost: 1.25,
          tokensIn: 0,
          tokensOut: 0,
          cached: 2,
          scanned: 3,
          pages: 1,
          truncated: false,
        },
      ),
    ).toEqual([{ type: 'text', text: 'Session s1: 3 requests, 2 served from cache, cost 1.25.' }])
  })
})

describe('sessionOf', () => {
  it('reads the session id the gateway recorded', () => {
    expect(sessionOf({ metadata: JSON.stringify({ sessionId: 's1' }) })).toBe('s1')
  })

  it.each([
    ['metadata is absent', {}],
    ['metadata is not a string', { metadata: { sessionId: 's1' } }],
    ['metadata is not valid JSON', { metadata: '{oops' }],
    ['metadata is not an object', { metadata: '"a string"' }],
    ['metadata is null', { metadata: 'null' }],
    ['the session id is not a string', { metadata: JSON.stringify({ sessionId: 7 }) }],
    ['the session id is absent', { metadata: JSON.stringify({ purpose: 'compaction' }) }],
  ])('returns nothing when %s', (_label, entry) => {
    expect(sessionOf(entry)).toBeUndefined()
  })
})

describe('summariseSessionLogs refusals', () => {
  it('adds up the fields a gateway log carries', () => {
    expect(
      summariseSessionLogs([
        { cost: 1, tokens_in: 2, tokens_out: 3, cached: true },
        { cost: 2, tokens_in: 1, tokens_out: 1 },
      ]),
    ).toEqual({ requests: 2, cost: 3, tokensIn: 3, tokensOut: 4, cached: 1 })
  })

  it('treats a missing field as zero, since providers omit some', () => {
    expect(summariseSessionLogs([{}])).toEqual({
      requests: 1,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
    })
  })

  it.each([
    ['not a number', 'cost', '0.004'],
    ['NaN', 'cost', Number.NaN],
    ['infinite', 'cost', Number.POSITIVE_INFINITY],
    ['NaN tokens in', 'tokens_in', Number.NaN],
    ['NaN tokens out', 'tokens_out', Number.NaN],
  ])('refuses a %s value rather than producing a silently wrong total', (_label, field, value) => {
    // Tested here rather than through the tool: a JSON round-trip turns NaN and
    // Infinity into null, so the transport would hide these cases entirely.
    expect(() => summariseSessionLogs([{ [field]: value }])).toThrow(
      expect.objectContaining({ name: 'GatewayLogShapeError' }),
    )
  })
})

describe('what the usage chip is given', () => {
  it('publishes the five figures the chip renders, which the summary line carries three of', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    const meta = h.tool('cloudflare_aigateway_session_cost').output.presentationMeta?.(
      { gatewayId: 'gw1', sessionId: 's1' },
      {
        requests: 4,
        cost: 0.0125,
        tokensIn: 120,
        tokensOut: 40,
        cached: 1,
        scanned: 9,
        pages: 1,
        truncated: false,
      },
    )
    expect(meta).toEqual({ requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 })
  })
})
