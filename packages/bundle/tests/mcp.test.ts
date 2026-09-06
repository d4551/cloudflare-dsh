import { describe, expect, it } from 'vitest'
import { CLOUDFLARE_MCP_SERVERS, mcpPatchRow, mcpPatchRows } from '../src/mcp/index.ts'

/** A well-formed server, for the rows that are about `mcpPatchRow` itself. */
const server = (serverName: string, url = 'https://x.test/mcp') => ({
  serverName,
  url,
  summary: 'A server.',
})

describe('CLOUDFLARE_MCP_SERVERS', () => {
  it('names every server Cloudflare publishes, and no others', () => {
    // The names, not the count. A count says nothing about which servers are
    // there, and it was the whole of what this test used to assert.
    expect(CLOUDFLARE_MCP_SERVERS.map((s) => s.serverName)).toEqual([
      'cloudflare-code-mode',
      'cloudflare-docs',
      'cloudflare-bindings',
      'cloudflare-builds',
      'cloudflare-observability',
      'cloudflare-containers',
      'cloudflare-browser',
      'cloudflare-logpush',
      'cloudflare-ai-gateway',
      'cloudflare-autorag',
      'cloudflare-audit-logs',
      'cloudflare-dns-analytics',
      'cloudflare-dex',
      'cloudflare-casb',
      'cloudflare-radar',
      'cloudflare-blog',
      'cloudflare-demo-day',
    ])
  })

  it('points each server at its own host under mcp.cloudflare.com', () => {
    // Asserted as a list rather than in a loop: a loop over an empty array
    // asserts nothing at all and still passes, and the endpoint is the part a
    // profile actually connects to.
    expect(CLOUDFLARE_MCP_SERVERS.map((s) => s.url)).toEqual([
      'https://mcp.cloudflare.com/mcp',
      'https://docs.mcp.cloudflare.com/mcp',
      'https://bindings.mcp.cloudflare.com/mcp',
      'https://builds.mcp.cloudflare.com/mcp',
      'https://observability.mcp.cloudflare.com/mcp',
      'https://containers.mcp.cloudflare.com/mcp',
      'https://browser.mcp.cloudflare.com/mcp',
      'https://logs.mcp.cloudflare.com/mcp',
      'https://ai-gateway.mcp.cloudflare.com/mcp',
      'https://autorag.mcp.cloudflare.com/mcp',
      'https://auditlogs.mcp.cloudflare.com/mcp',
      'https://dns-analytics.mcp.cloudflare.com/mcp',
      'https://dex.mcp.cloudflare.com/mcp',
      'https://casb.mcp.cloudflare.com/mcp',
      'https://radar.mcp.cloudflare.com/mcp',
      'https://blog.mcp.cloudflare.com/mcp',
      'https://demo-day.mcp.cloudflare.com/mcp',
    ])
  })

  it('names every server within the harness constraint', () => {
    expect(CLOUDFLARE_MCP_SERVERS.length).toBeGreaterThan(0)
    expect(
      CLOUDFLARE_MCP_SERVERS.filter((s) => !/^[A-Za-z0-9_-]{1,32}$/u.test(s.serverName)).map(
        (s) => s.serverName,
      ),
    ).toEqual([])
  })

  it('gives every server a summary, so a profile can choose without leaving the file', () => {
    expect(CLOUDFLARE_MCP_SERVERS.filter((s) => s.summary.trim() === '')).toEqual([])
  })

  it('has no duplicate server names', () => {
    const names = CLOUDFLARE_MCP_SERVERS.map((s) => s.serverName)
    expect(new Set(names).size).toBe(names.length)
  })

  it('has no duplicate endpoints, since two names on one host would bridge twice', () => {
    const urls = CLOUDFLARE_MCP_SERVERS.map((s) => s.url)
    expect(new Set(urls).size).toBe(urls.length)
  })
})

describe('mcpPatchRow', () => {
  it('mounts a server through the harness MCP client', () => {
    expect(mcpPatchRow(server('cf-docs'))).toStrictEqual({
      id: 'mcp-cf-docs',
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'cf-docs', transport: 'streamable-http', url: 'https://x.test/mcp' },
    })
  })

  it('rejects an empty server name', () => {
    expect(() => mcpPatchRow(server(''))).toThrow('MCP serverName "" must match')
  })

  it('rejects a server name with characters the MCP client forbids', () => {
    expect(() => mcpPatchRow(server('bad name'))).toThrow('MCP serverName "bad name" must match')
  })

  it('rejects a server name longer than 32 characters', () => {
    expect(() => mcpPatchRow(server('a'.repeat(33)))).toThrow(`MCP serverName "${'a'.repeat(33)}" must match`)
  })

  it('accepts a server name of exactly 32 characters', () => {
    expect(mcpPatchRow(server('a'.repeat(32))).id).toBe(`mcp-${'a'.repeat(32)}`)
  })
})

describe('mcpPatchRows', () => {
  it('builds rows for the named servers', () => {
    const rows = mcpPatchRows(['cloudflare-docs', 'cloudflare-browser'])
    expect(rows.map((r) => r.config.serverName)).toEqual(['cloudflare-docs', 'cloudflare-browser'])
  })

  it('returns nothing for an empty selection', () => {
    expect(mcpPatchRows([])).toEqual([])
  })

  it('rejects an unknown server rather than silently skipping it', () => {
    expect(() => mcpPatchRows(['nope'])).toThrow('unknown Cloudflare MCP server "nope"')
  })

  it('gives every published server a row carrying its own endpoint', () => {
    // Input and expectation used to be the same array, which holds however the
    // function behaves. The rows are compared against the endpoints instead.
    const rows = mcpPatchRows(CLOUDFLARE_MCP_SERVERS.map((s) => s.serverName))
    expect(rows.map((r) => r.config.url)).toEqual(CLOUDFLARE_MCP_SERVERS.map((s) => s.url))
    expect(rows.map((r) => r.id)).toEqual(CLOUDFLARE_MCP_SERVERS.map((s) => `mcp-${s.serverName}`))
  })
})
