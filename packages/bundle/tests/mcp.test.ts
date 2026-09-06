import { describe, expect, it } from 'vitest'
import { CLOUDFLARE_MCP_SERVERS, mcpPatchRow, mcpPatchRows } from '../src/mcp/index.ts'

describe('CLOUDFLARE_MCP_SERVERS', () => {
  it('lists the hosted servers', () => {
    expect(CLOUDFLARE_MCP_SERVERS.length).toBe(8)
  })

  it('names every server within the harness constraint', () => {
    for (const s of CLOUDFLARE_MCP_SERVERS) {
      expect(s.serverName).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    }
  })

  it('gives every server an https endpoint', () => {
    for (const s of CLOUDFLARE_MCP_SERVERS) {
      expect(s.url.startsWith('https://')).toBe(true)
    }
  })

  it('has no duplicate server names', () => {
    const names = CLOUDFLARE_MCP_SERVERS.map((s) => s.serverName)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('mcpPatchRow', () => {
  it('mounts a server through the harness MCP client', () => {
    expect(mcpPatchRow({ serverName: 'cf-docs', url: 'https://x.test/mcp' })).toStrictEqual({
      id: 'mcp-cf-docs',
      name: '@deepseek-ai/dsh-mcp-client',
      config: { serverName: 'cf-docs', transport: 'streamable-http', url: 'https://x.test/mcp' },
    })
  })

  it('rejects an empty server name', () => {
    expect(() => mcpPatchRow({ serverName: '', url: 'https://x.test' })).toThrow(TypeError)
  })

  it('rejects a server name with characters the MCP client forbids', () => {
    expect(() => mcpPatchRow({ serverName: 'bad name', url: 'https://x.test' })).toThrow(/must match/)
  })

  it('rejects a server name longer than 32 characters', () => {
    expect(() => mcpPatchRow({ serverName: 'a'.repeat(33), url: 'https://x.test' })).toThrow(TypeError)
  })

  it('accepts a server name of exactly 32 characters', () => {
    expect(mcpPatchRow({ serverName: 'a'.repeat(32), url: 'https://x.test' }).id).toBe(
      `mcp-${'a'.repeat(32)}`,
    )
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

  it('builds a row for every published server', () => {
    expect(mcpPatchRows(CLOUDFLARE_MCP_SERVERS.map((s) => s.serverName))).toHaveLength(
      CLOUDFLARE_MCP_SERVERS.length,
    )
  })
})
