/**
 * Account discovery and the bounded generic API tool.
 *
 * `cloudflare_api` reaches the ~70 Cloudflare resources this bundle does not
 * wrap. It is deliberately contained: read-only unless explicitly configured
 * otherwise, subject to a path denylist, and unable to leave the REST root.
 */
import type { CloudflareService, HttpMethod } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { buildGenericSpec } from '../specs/meta.ts'
import type { JsonValue } from './_shared/json.ts'
import { json, listing } from './_shared/render.ts'

interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

/** Methods the generic tool advertises to the model. */
const METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']

export interface MetaConfig {
  /** Permit state-changing verbs through `cloudflare_api`. Off by default. */
  allowMutations: boolean
  /** Path prefixes `cloudflare_api` must refuse, whatever the method. */
  denyPathPrefixes: string[]
}

export const Config: Schema<Partial<MetaConfig>, MetaConfig> = Schema.object({
  allowMutations: Schema.boolean().default(false),
  denyPathPrefixes: Schema.array(Schema.string()).default([]),
})

export const name = 'cloudflare-tools-meta'
export const inject = ['tools', 'cloudflare'] as const

export function apply(ctx: Context, config: MetaConfig): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_account_list',
      description: 'List the Cloudflare accounts this API token can access.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Accounts with ids and names.' },
        render: (_args, value) => listing((value as { accounts: unknown[] }).accounts.length, 'account', value),
      },
      isConcurrencySafe: () => true,
      async execute() {
        const accounts = await cf.listAccounts()
        return { accounts: accounts as unknown as JsonValue[] }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_api',
      description:
        'Call any Cloudflare REST endpoint under /client/v4 that this bundle does not wrap with a dedicated tool. Paths are relative to the API root, e.g. /accounts/{account_id}/hyperdrive/configs. Read-only unless the plugin is configured to permit mutations.',
      parameters: {
        method: {
          type: 'string',
          required: true,
          enum: METHODS,
          description: 'HTTP method.',
        },
        path: {
          type: 'string',
          required: true,
          description: 'Path under /client/v4, starting with a slash.',
        },
        query: {
          type: 'object',
          additionalProperties: true,
          description: 'Query string parameters.',
        },
        body: { type: 'json', description: 'Request body for writing methods.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'The unwrapped Cloudflare result for the call.',
        },
        render: (_args, value) => json((value as { result: JsonValue }).result),
      },
      async execute(args) {
        const spec = buildGenericSpec(
          args.method as HttpMethod,
          args.path,
          args.query as Record<string, string> | undefined,
          args.body,
          { allowMutations: config.allowMutations, denyPathPrefixes: config.denyPathPrefixes },
        )
        const result = await cf.client.request<JsonValue>(spec)
        return { result }
      },
    }),
  )
}
