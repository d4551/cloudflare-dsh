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
export const CLOUDFLARE_MCP_SERVERS: readonly CloudflareMcpServer[] = [
  {
    serverName: 'cloudflare-code-mode',
    url: 'https://mcp.cloudflare.com/mcp',
    summary: 'Broad access across the Cloudflare API through code execution.',
  },
  {
    serverName: 'cloudflare-docs',
    url: 'https://docs.mcp.cloudflare.com/mcp',
    summary: 'Up-to-date reference information on Cloudflare.',
  },
  {
    serverName: 'cloudflare-bindings',
    url: 'https://bindings.mcp.cloudflare.com/mcp',
    summary: 'Build Workers applications with storage, AI and compute primitives.',
  },
  {
    serverName: 'cloudflare-builds',
    url: 'https://builds.mcp.cloudflare.com/mcp',
    summary: 'Insight into and management of Workers Builds.',
  },
  {
    serverName: 'cloudflare-observability',
    url: 'https://observability.mcp.cloudflare.com/mcp',
    summary: 'Debug an application from its logs and analytics.',
  },
  {
    serverName: 'cloudflare-containers',
    url: 'https://containers.mcp.cloudflare.com/mcp',
    summary: 'Spin up a sandbox development environment.',
  },
  {
    serverName: 'cloudflare-browser',
    url: 'https://browser.mcp.cloudflare.com/mcp',
    summary: 'Fetch pages, convert them to markdown and take screenshots.',
  },
  {
    serverName: 'cloudflare-logpush',
    url: 'https://logs.mcp.cloudflare.com/mcp',
    summary: 'Summaries of Logpush job health.',
  },
  {
    serverName: 'cloudflare-ai-gateway',
    url: 'https://ai-gateway.mcp.cloudflare.com/mcp',
    summary: 'Search gateway logs and read the prompts and responses behind them.',
  },
  {
    serverName: 'cloudflare-autorag',
    url: 'https://autorag.mcp.cloudflare.com/mcp',
    summary: 'Search and query the account’s AutoRAG instances.',
  },
  {
    serverName: 'cloudflare-audit-logs',
    url: 'https://auditlogs.mcp.cloudflare.com/mcp',
    summary: 'Query audit logs and generate reports for review.',
  },
  {
    serverName: 'cloudflare-dns-analytics',
    url: 'https://dns-analytics.mcp.cloudflare.com/mcp',
    summary: 'Optimise DNS performance and debug the current setup.',
  },
  {
    serverName: 'cloudflare-dex',
    url: 'https://dex.mcp.cloudflare.com/mcp',
    summary: 'Digital Experience Monitoring insight into critical applications.',
  },
  {
    serverName: 'cloudflare-casb',
    url: 'https://casb.mcp.cloudflare.com/mcp',
    summary: 'Identify SaaS security misconfigurations across users and data.',
  },
  {
    serverName: 'cloudflare-radar',
    url: 'https://radar.mcp.cloudflare.com/mcp',
    summary: 'Explore Cloudflare Radar internet insights.',
  },
  {
    serverName: 'cloudflare-blog',
    url: 'https://blog.mcp.cloudflare.com/mcp',
    summary: 'Search and read posts from the Cloudflare Blog.',
  },
  {
    serverName: 'cloudflare-demo-day',
    url: 'https://demo-day.mcp.cloudflare.com/mcp',
    summary: 'A minimal Cloudflare MCP server, published as a demonstration.',
  },
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
