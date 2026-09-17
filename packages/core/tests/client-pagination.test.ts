import { describe, expect, it } from 'vitest'
import { byCursor, json, makeClient, ok } from './support/client-fixture.ts'

/** A mid-walk server error, built fresh per call: a walk now retries, so a
 * fixed queue of responses would run out and fail for the wrong reason. */
const failure = (): Response =>
  json(
    {
      success: false,
      errors: [{ code: 2, message: 'mid' }],
      messages: [],
      result: null,
    },
    { status: 500 },
  )

describe('CloudflareClient.list', () => {
  it('walks pages via the cursor', async () => {
    const pages = [json(ok(['a'], { cursor: 'c1' })), json(ok(['b'], { cursor: '' }))]
    let i = 0
    const { client, requests } = makeClient(async () => pages[i++]!, {
      baseUrl: 'https://api.test/client/v4',
    })
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).resolves.toEqual({
      items: ['a', 'b'],
      truncated: false,
      pages: 2,
    })
    expect(requests[1]!.url).toBe('https://api.test/client/v4/x?cursor=c1')
  })

  it('merges the spec query with the page overlay', async () => {
    const pages = [json(ok(['a'], { cursor: 'c1' })), json(ok(['b'], { cursor: '' }))]
    let i = 0
    const { client, requests } = makeClient(async () => pages[i++]!)
    await client.listAll({ method: 'GET', path: '/x', query: { per_page: 2 } }, byCursor)
    expect(requests[1]!.url).toContain('per_page=2')
    expect(requests[1]!.url).toContain('cursor=c1')
  })

  it('honours the maxPages ceiling', async () => {
    const { client, requests } = makeClient(async () => json(ok(['x'], { cursor: 'always' })), {
      maxPages: 3,
    })
    // Truncated: the server still offered a cursor when the ceiling hit.
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).resolves.toEqual({
      items: ['x', 'x', 'x'],
      truncated: true,
      pages: 3,
    })
    expect(requests).toHaveLength(3)
  })

  it('propagates an error mid-walk once the retry budget is spent', async () => {
    let call = 0
    const { client } = makeClient(async () => (call++ === 0 ? json(ok(['a'], { cursor: 'c1' })) : failure()))
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).rejects.toThrow('[2] mid')
  })

  it('retries a transient failure mid-walk instead of abandoning the page', async () => {
    // `listAll` used to bypass the retry policy entirely, so a single 500 on
    // page two ended the walk while the seam advertised retry.
    let call = 0
    const { client } = makeClient(async () => {
      call += 1
      if (call === 1) return json(ok(['a'], { cursor: 'c1' }))
      if (call === 2) return json({ success: false, errors: [], messages: [], result: null }, { status: 503 })
      return json(ok(['b'], { cursor: '' }))
    })
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).resolves.toMatchObject({
      items: ['a', 'b'],
    })
  })
})
