/**
 * Patch rows for Cloudflare's hosted MCP servers.
 *
 * These are not enabled by default. Each MCP server is trusted executable code
 * or a remote endpoint reached outside the agent sandbox, so turning one on is
 * a deliberate act by whoever owns the profile.
 *
 * Only tools are bridged into the harness; MCP resources and prompts are not.
 * Bridged tools appear as `mcp__<serverName>__<toolName>`.
 */

/** One hosted Cloudflare MCP server. */
export interface CloudflareMcpServer {
  /** Namespace for bridged tool names; must match [A-Za-z0-9_-]{1,32}. */
  readonly serverName: string
  /** Streamable-HTTP endpoint. */
  readonly url: string
  /** What the server is for. */
  readonly summary: string
}

/**
 * The hosted servers Cloudflare publishes.
 *
 * Authentication is OAuth in the browser, so these are useful in an
 * interactive profile and unsuitable for headless runs.
 */
export const CLOUDFLARE_MCP_SERVERS: readonly CloudflareMcpServer[] = [
  { serverName: 'cloudflare-docs', url: 'https://docs.mcp.cloudflare.com/mcp', summary: 'Search Cloudflare developer documentation.' },
  { serverName: 'cloudflare-bindings', url: 'https://bindings.mcp.cloudflare.com/mcp', summary: 'Manage Workers bindings: KV, R2, D1, Hyperdrive.' },
  { serverName: 'cloudflare-observability', url: 'https://observability.mcp.cloudflare.com/mcp', summary: 'Query Workers logs and analytics.' },
  { serverName: 'cloudflare-radar', url: 'https://radar.mcp.cloudflare.com/mcp', summary: 'Internet traffic and security insights.' },
  { serverName: 'cloudflare-browser', url: 'https://browser.mcp.cloudflare.com/mcp', summary: 'Browser rendering: fetch, screenshot, convert pages.' },
  { serverName: 'cloudflare-ai-gateway', url: 'https://ai-gateway.mcp.cloudflare.com/mcp', summary: 'Search and inspect AI Gateway logs.' },
  { serverName: 'cloudflare-autorag', url: 'https://autorag.mcp.cloudflare.com/mcp', summary: 'List and search AI Search (AutoRAG) instances.' },
  { serverName: 'cloudflare-logpush', url: 'https://logs.mcp.cloudflare.com/mcp', summary: 'Summarise Logpush job health.' },
]

/** A patch row that mounts one MCP server through the harness's MCP client. */
export interface McpPatchRow {
  readonly id: string
  readonly name: string
  readonly config: {
    readonly serverName: string
    readonly transport: 'streamable-http'
    readonly url: string
  }
}

/** Server-name constraint enforced by the harness's MCP client. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Build the patch row that mounts one server.
 *
 * @throws TypeError when the server name would be rejected by the MCP client.
 */
export function mcpPatchRow(server: CloudflareMcpServer): McpPatchRow {
  if (!SERVER_NAME.test(server.serverName)) {
    throw new TypeError(
      `MCP serverName ${JSON.stringify(server.serverName)} must match ${String(SERVER_NAME)}`,
    )
  }
  return {
    id: `mcp-${server.serverName}`,
    name: '@deepseek-ai/dsh-mcp-client',
    config: {
      serverName: server.serverName,
      transport: 'streamable-http',
      url: server.url,
    },
  }
}

/** Build patch rows for the named servers. */
export function mcpPatchRows(names: readonly string[]): McpPatchRow[] {
  return names.map((wanted) => {
    const server = CLOUDFLARE_MCP_SERVERS.find((s) => s.serverName === wanted)
    if (server === undefined) {
      throw new TypeError(`unknown Cloudflare MCP server ${JSON.stringify(wanted)}`)
    }
    return mcpPatchRow(server)
  })
}

