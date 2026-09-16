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
  /** What the server is for, so a profile can choose without leaving the file. */
  readonly summary: string
}

/**
 * The hosted servers Cloudflare publishes.
 *
 * Authentication is OAuth in the browser, so these are useful in an
 * interactive profile and unsuitable for headless runs.
 *
 * `cloudflare-autorag` keeps that name deliberately. The REST product was
 * renamed AI Search — which is why `specs/ai.ts` addresses `/ai-search` — but
 * the hosted MCP server is still published as AutoRAG at the AutoRAG host, and
 * this list names servers as Cloudflare publishes them rather than as the
 * product is called this quarter.
 */
/** One hosted server, as Cloudflare publishes it. */
function hosted(serverName: string, url: string, summary: string): CloudflareMcpServer {
  return { serverName, url, summary }
}

export const CLOUDFLARE_MCP_SERVERS: readonly CloudflareMcpServer[] = [
  hosted(
    'cloudflare-code-mode',
    'https://mcp.cloudflare.com/mcp',
    'Broad access across the Cloudflare API through code execution.',
  ),
  hosted(
    'cloudflare-docs',
    'https://docs.mcp.cloudflare.com/mcp',
    'Up-to-date reference information on Cloudflare.',
  ),
  hosted(
    'cloudflare-bindings',
    'https://bindings.mcp.cloudflare.com/mcp',
    'Build Workers applications with storage, AI and compute primitives.',
  ),
  hosted(
    'cloudflare-builds',
    'https://builds.mcp.cloudflare.com/mcp',
    'Insight into and management of Workers Builds.',
  ),
  hosted(
    'cloudflare-observability',
    'https://observability.mcp.cloudflare.com/mcp',
    'Debug an application from its logs and analytics.',
  ),
  hosted(
    'cloudflare-containers',
    'https://containers.mcp.cloudflare.com/mcp',
    'Spin up a sandbox development environment.',
  ),
  hosted(
    'cloudflare-browser',
    'https://browser.mcp.cloudflare.com/mcp',
    'Fetch pages, convert them to markdown and take screenshots.',
  ),
  hosted('cloudflare-logpush', 'https://logs.mcp.cloudflare.com/mcp', 'Summaries of Logpush job health.'),
  hosted(
    'cloudflare-ai-gateway',
    'https://ai-gateway.mcp.cloudflare.com/mcp',
    'Search gateway logs and read the prompts and responses behind them.',
  ),
  hosted(
    'cloudflare-autorag',
    'https://autorag.mcp.cloudflare.com/mcp',
    'Search and query the account’s AutoRAG instances.',
  ),
  hosted(
    'cloudflare-audit-logs',
    'https://auditlogs.mcp.cloudflare.com/mcp',
    'Query audit logs and generate reports for review.',
  ),
  hosted(
    'cloudflare-dns-analytics',
    'https://dns-analytics.mcp.cloudflare.com/mcp',
    'Optimise DNS performance and debug the current setup.',
  ),
  hosted(
    'cloudflare-dex',
    'https://dex.mcp.cloudflare.com/mcp',
    'Digital Experience Monitoring insight into critical applications.',
  ),
  hosted(
    'cloudflare-casb',
    'https://casb.mcp.cloudflare.com/mcp',
    'Identify SaaS security misconfigurations across users and data.',
  ),
  hosted(
    'cloudflare-radar',
    'https://radar.mcp.cloudflare.com/mcp',
    'Explore Cloudflare Radar internet insights.',
  ),
  hosted(
    'cloudflare-blog',
    'https://blog.mcp.cloudflare.com/mcp',
    'Search and read posts from the Cloudflare Blog.',
  ),
  hosted(
    'cloudflare-demo-day',
    'https://demo-day.mcp.cloudflare.com/mcp',
    'A minimal Cloudflare MCP server, published as a demonstration.',
  ),
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
