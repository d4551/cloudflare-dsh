/**
 * Account discovery and the bounded generic API tool.
 *
 * `cloudflare_api` reaches the ~70 Cloudflare resources this bundle does not
 * wrap. It is deliberately contained: read-only unless explicitly configured
 * otherwise, subject to a path denylist, and unable to leave the REST root.
 */
import type { HttpMethod, QueryValue } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { buildGenericSpec } from '../specs/meta.ts'
import type { JsonValue } from './_shared/json.ts'
import { json, listing } from './_shared/render.ts'
import { seam } from '../seam.ts'

/** Raised when a query value has no unambiguous text form. */
export class ApiQueryError extends TypeError {
  override readonly name = 'ApiQueryError'
}

/** One query value that serializes as itself. */
function scalarQueryValue(name: string, value: JsonValue): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  throw new ApiQueryError(`query.${name} must be a string, number or boolean`)
}

/**
 * Validate caller-supplied query parameters for the wire.
 *
 * Strings, numbers and booleans serialize as themselves and an array of them
 * repeats the key. `null`, an object or a nested array would go on the wire as
 * text like "[object Object]", so each is refused by name rather than cast.
 */
export function toQuery(
  raw: Readonly<Record<string, JsonValue>> | undefined,
): Record<string, QueryValue> | undefined {
  if (raw === undefined) return undefined
  const query: Record<string, QueryValue> = {}
  for (const [key, value] of Object.entries(raw)) {
    query[key] = Array.isArray(value)
      ? value.map((item, index) => scalarQueryValue(`${key}[${index}]`, item))
      : scalarQueryValue(key, value)
  }
  return query
}

/** Methods that cannot change server state; all the tool offers unless mutations are permitted. */
const READ_METHODS: readonly HttpMethod[] = ['GET', 'HEAD']

/** Every method the tool can offer once mutations are permitted. */
const ALL_METHODS: readonly HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']

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
export const inject = ['tools', 'cloudflare']

export function apply(ctx: Context, config: MetaConfig): void {
  const cf = seam(ctx)

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_account_list',
      description: 'List the Cloudflare accounts this API token can access.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Accounts the token can reach.',
          properties: {
            accounts: {
              type: 'array',
              required: true,
              description: 'Accounts, projected to id and name.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  name: { type: 'string', required: true },
                },
              },
            },
            truncated: {
              type: 'boolean',
              required: true,
              description: 'Whether the page ceiling cut the list short.',
            },
          },
        },
        render: (_args, value) => listing(value.accounts.length, 'account', value),
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const { accounts, truncated } = await cf.listAccounts(exec.signal)
        // Projected field by field rather than cast: the canonical value is a
        // programmatic API under PTC, so it is declared here, not inherited
        // from whatever the REST response happened to carry. `truncated` says
        // when the page ceiling stopped the walk, so a partial list is never
        // reported as the whole one.
        return {
          accounts: accounts.map((account) => ({ id: account.id, name: account.name })),
          truncated,
        }
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
          // Decided by the schema, so a method the plugin does not permit is
          // never offered to the model and never reaches execution.
          enum: config.allowMutations ? ALL_METHODS : READ_METHODS,
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
          additionalProperties: false,
          description: 'The envelope result, whatever the endpoint returned.',
          properties: {
            result: { type: 'json', required: true, description: 'The result field of the API envelope.' },
          },
        },
        render: (_args, value) => json(value.result),
      },
      // The read/write split the schema already enforces, answered per call: a
      // GET or a HEAD changes nothing, so the harness may run it alongside
      // others. Every other tool answers this with a constant; this is the one
      // whose safety depends on what it was asked to do.
      isConcurrencySafe: (args) => READ_METHODS.includes(args.method),
      async execute(args, exec) {
        const spec = buildGenericSpec(args.method, args.path, toQuery(args.query), args.body, {
          denyPathPrefixes: config.denyPathPrefixes,
        })
        const result = await cf.client.request<JsonValue>({ ...spec, signal: exec.signal })
        return { result }
      },
    }),
  )
}
