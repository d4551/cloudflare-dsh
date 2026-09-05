/**
 * Registers Cloudflare as a model provider for the harness itself.
 *
 * Two routes are offered. `cloudflare-workers-ai` talks to the account's
 * OpenAI-compatible Workers AI endpoint directly. `cloudflare-ai-gateway`
 * routes through an AI Gateway, which is the interesting one: every request
 * carries the harness session id in `cf-aig-metadata`, so the gateway's own
 * logs and billing can be read back per session (see
 * `cloudflare_aigateway_session_cost`).
 *
 * The gateway's base URL is resolved from the API rather than hardcoded —
 * Cloudflare is the authority on its own endpoint shape, and a hardcoded URL
 * would also be a tunable that config could not change.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import Schema from '@deepseek-ai/schemastery'
import { aiModelsSearchSpec, gatewayUrlSpec } from '../specs/ai.ts'
import { CloudflareAiAdapter, type ResolvedEndpoint } from './adapter.ts'

export { CloudflareAiAdapter, readErrorDetail } from './adapter.ts'
export type { CloudflareAiAdapterDeps, ResolvedEndpoint } from './adapter.ts'
export * from './errors.ts'
export type { GatewayHeaderOptions, RequestIdentity } from './headers.ts'
export { buildGatewayHeaders, buildGatewayMetadata } from './headers.ts'
export type { WireMessage, WireRequest, WireTool } from './request.ts'
export { buildWireRequest, textOf, toWireMessages, toWireTools } from './request.ts'
export type { ParsedJson, SseEvent } from './sse.ts'
export { SSE_DONE, SseDecoder, decodeLine, parseJson } from './sse.ts'
export type { WireChunk, WireChoice, WireDelta, WireToolCallDelta, WireUsage } from './transducer.ts'
export { StreamTransducer, mapFinishReason, mapUsage } from './transducer.ts'

/**
 * Page size for a catalogue lookup by exact name. The search is a substring
 * match, so a page must hold every model whose name contains the one asked
 * for; the endpoint's own ceiling is the safe bound.
 */
const CATALOGUE_LOOKUP_PAGE_SIZE = 100

/** Route names this plugin registers. */
export const WORKERS_AI_PROVIDER = 'cloudflare-workers-ai'
export const AI_GATEWAY_PROVIDER = 'cloudflare-ai-gateway'

interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

export interface AiConfig {
  /** Gateway to route through. Required for the ai-gateway route. */
  gatewayId: string
  /** Provider slug the gateway forwards to. */
  gatewayProvider: string
  /** Path appended to a resolved base URL to reach chat completions. */
  chatCompletionsPath: string
  /** OpenAI-compatible Workers AI path, relative to the account scope. */
  workersAiPath: string
  /** Seconds an identical request may be served from the gateway cache. */
  cacheTtlSeconds: number
  /** Bypass the gateway cache. */
  skipCache: boolean
  /** Ask the gateway to store request and response bodies. */
  collectLog: boolean
  /** Static tags merged into cf-aig-metadata alongside the session id. */
  tags: Record<string, string>
  /** Per-token cost override recorded by the gateway; zero means do not send one. */
  customCostPerTokenIn: number
  /** Per-token output cost override; paired with `customCostPerTokenIn`. */
  customCostPerTokenOut: number
  /** Gateway-side request timeout in milliseconds; zero leaves the gateway default. */
  gatewayRequestTimeoutMs: number
  /** How long a stream may go quiet before it is failed. */
  streamIdleTimeoutMs: number
  /** Models advertised by listModels; empty means query the catalogue. */
  models: string[]
}

export const Config: Schema<Partial<AiConfig>, AiConfig> = Schema.object({
  gatewayId: Schema.string().default(''),
  gatewayProvider: Schema.string().default('workers-ai'),
  chatCompletionsPath: Schema.string().default('/chat/completions'),
  workersAiPath: Schema.string().default('/ai/v1/chat/completions'),
  cacheTtlSeconds: Schema.number().default(0),
  skipCache: Schema.boolean().default(false),
  collectLog: Schema.boolean().default(true),
  tags: Schema.dict(Schema.string()).default({}),
  customCostPerTokenIn: Schema.number().default(0),
  customCostPerTokenOut: Schema.number().default(0),
  gatewayRequestTimeoutMs: Schema.number().default(0),
  streamIdleTimeoutMs: Schema.number().default(300_000),
  models: Schema.array(Schema.string()).default([]),
})

export const name = 'cloudflare-llm'
export const inject = ['llm', 'cloudflare']

/** Raised when the gateway route is used without a gateway configured. */
export class MissingGatewayError extends Error {
  override readonly name = 'MissingGatewayError'
  constructor() {
    super(`the ${AI_GATEWAY_PROVIDER} route needs a gatewayId; set it on the cloudflare-llm plugin config`)
  }
}

/** Join a base URL and a path without doubling or dropping the separator. */
export function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return path.startsWith('/') ? `${trimmed}${path}` : `${trimmed}/${path}`
}

/** Shape the gateway URL endpoint returns. */
interface GatewayUrlResult {
  readonly url?: string
}

/** One catalogue record, in the fields this plugin reads. */
export interface CatalogueModel {
  readonly name?: string
  readonly description?: string
  /** Cloudflare publishes model facts as `{ property_id, value }` pairs, values as strings. */
  readonly properties?: readonly { readonly property_id?: string; readonly value?: unknown }[]
}

/**
 * Turn one catalogue record into the metadata the harness can use for a call.
 *
 * `context_window` becomes the context size when it is a positive whole number,
 * and the `vision` property widens the input modalities to images. A model the
 * catalogue does not list keeps the bare identity: the list is advisory, and an
 * unlisted id must still be callable.
 */
export function toResolvedModelInfo(
  provider: string,
  model: string,
  record: CatalogueModel | undefined,
): LlmResolvedModelInfo {
  if (record === undefined) return { provider, id: model, name: model }
  const properties = new Map(record.properties?.map((entry) => [entry.property_id, entry.value]))
  const contextWindow = Number(properties.get('context_window'))
  return {
    provider,
    id: model,
    name: model,
    ...(record.description === undefined ? {} : { description: record.description }),
    inputModalities: properties.get('vision') === 'true' ? ['text', 'image'] : ['text'],
    ...(Number.isInteger(contextWindow) && contextWindow > 0 ? { context: { contextWindow } } : {}),
  }
}

/**
 * Turn the catalogue response into advisory model info.
 *
 * The harness treats this list as advisory, so an unlisted model must still be
 * accepted at request time; nothing here rejects anything.
 */
export function toModelInfo(
  provider: string,
  models: readonly { name?: string; description?: string }[],
): LlmModelInfo[] {
  const info: LlmModelInfo[] = []
  for (const model of models) {
    const id = model.name
    if (id === undefined || id === '') continue
    info.push(
      model.description === undefined
        ? { provider, id, name: id }
        : { provider, id, name: id, description: model.description },
    )
  }
  return info
}

export function apply(ctx: Context, config: AiConfig): void {
  const cf = (ctx as CloudflareContext).cloudflare
  const llm = ctx.llm

  // The endpoint URL is a fact of this configuration — the gateway's advertised
  // base, or the account's OpenAI-compatible path — so it is read once per
  // plugin instance rather than once per model call. The token is resolved on
  // every call and never cached.
  const endpointUrls = new Map<string, string>()

  async function endpointUrl(provider: string, signal: AbortSignal | undefined): Promise<string> {
    const known = endpointUrls.get(provider)
    if (known !== undefined) return known
    let url: string
    if (provider === AI_GATEWAY_PROVIDER) {
      if (config.gatewayId === '') throw new MissingGatewayError()
      const result = await cf.accountRequest<GatewayUrlResult>({
        ...gatewayUrlSpec(config.gatewayId, config.gatewayProvider),
        signal,
      })
      const base = result.url
      if (base === undefined || base === '') {
        throw new MissingGatewayError()
      }
      url = joinUrl(base, config.chatCompletionsPath)
    } else {
      const scope = await cf.accountScope(signal)
      url = joinUrl(cf.config.baseUrl, `/accounts/${encodeURIComponent(scope.id)}${config.workersAiPath}`)
    }
    endpointUrls.set(provider, url)
    return url
  }

  async function resolveEndpoint(
    provider: string,
    _model: string,
    signal?: AbortSignal,
  ): Promise<ResolvedEndpoint> {
    const [token, url] = await Promise.all([cf.client.resolveToken(), endpointUrl(provider, signal)])
    return { url, token }
  }

  // Model facts change when Cloudflare changes them, not between two calls of
  // one plugin instance; one catalogue lookup per model is enough.
  const modelInfo = new Map<string, LlmResolvedModelInfo>()

  async function resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const key = `${provider} ${model}`
    const known = modelInfo.get(key)
    if (known !== undefined) return known
    const matches = await cf.accountRequest<CatalogueModel[]>({
      ...aiModelsSearchSpec(model, undefined, CATALOGUE_LOOKUP_PAGE_SIZE),
      signal,
    })
    const info = toResolvedModelInfo(
      provider,
      model,
      matches.find((record) => record.name === model),
    )
    modelInfo.set(key, info)
    return info
  }

  async function listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (config.models.length > 0) {
      return config.models.map((id) => ({ provider, id, name: id }))
    }
    const models = await cf.accountRequest<{ name?: string; description?: string }[]>(
      aiModelsSearchSpec(undefined, undefined, 100),
    )
    return toModelInfo(provider, models)
  }

  const adapter = new CloudflareAiAdapter({
    resolveEndpoint,
    resolveModel,
    listModels,
    fetch: (request) => fetch(request),
    headerOptions: {
      cacheTtlSeconds: config.cacheTtlSeconds,
      skipCache: config.skipCache,
      collectLog: config.collectLog,
      tags: config.tags,
      gatewayId: config.gatewayId,
      requestTimeoutMs: config.gatewayRequestTimeoutMs,
      // Only sent when a real override is configured: a zero-cost pair would
      // tell the gateway every request was free.
      ...(config.customCostPerTokenIn > 0 || config.customCostPerTokenOut > 0
        ? {
            customCost: {
              perTokenIn: config.customCostPerTokenIn,
              perTokenOut: config.customCostPerTokenOut,
            },
          }
        : {}),
    },
    streamIdleTimeoutMs: config.streamIdleTimeoutMs,
  })

  // The runtime scopes the registration to this plugin's fiber ("disposed with
  // the fiber"), so unloading the plugin unregisters the adapter. A disposer
  // returned from here would go unused: cordis instantiates a constructible
  // `apply` as a class and reads no effect from its return value.
  llm.registerAdapter([WORKERS_AI_PROVIDER, AI_GATEWAY_PROVIDER], adapter)
}
