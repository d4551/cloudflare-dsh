/**
 * AI Gateway request headers.
 *
 * Pure: a function of the request options and plugin config, with no I/O, so
 * the header contract is fully unit-testable.
 *
 * The point of this module is `cf-aig-metadata`. Stamping each request with the
 * harness session id makes AI Gateway's logs filterable back to one session,
 * which is what turns gateway cost and cache data into per-session numbers.
 * `GenerateOptions` carries `sessionId` for exactly this: the harness documents
 * it as something "adapters may map to model-hidden transport metadata".
 */

/**
 * Metadata key carrying the harness session id.
 *
 * Exported because the reader must use the same string as the writer: the
 * session-cost tool filters gateway logs on `metadata.key eq <this>`, and the
 * two drifting apart would silently return no rows.
 */
export const SESSION_METADATA_KEY = 'sessionId'

/** Metadata key distinguishing housekeeping calls from real agent turns. */
const PURPOSE_METADATA_KEY = 'purpose'

/**
 * Entries AI Gateway accepts in `cf-aig-metadata`.
 *
 * Documented limit, not a tunable. Extras are dropped **silently** by the
 * gateway, and the session id being the entry dropped would break cost
 * attribution with no error anywhere — so the builder enforces it instead.
 */
export const MAX_METADATA_ENTRIES = 5

/** Gateway behaviour this adapter can request per call. */
export interface GatewayHeaderOptions {
  /** Seconds to cache an identical request; 0 disables caching. */
  readonly cacheTtlSeconds?: number | undefined
  /** Bypass the cache for this request. */
  readonly skipCache?: boolean | undefined
  /**
   * Override the per-token cost Cloudflare records for this request.
   *
   * The documented value is an object, not a scalar
   * (`ai-gateway/configuration/custom-costs.mdx`), so it is modelled as one.
   */
  readonly customCost?: { readonly perTokenIn: number; readonly perTokenOut: number } | undefined
  /** Whether the gateway should store request and response bodies. */
  readonly collectLog?: boolean | undefined
  /** Static tags merged into the metadata. */
  readonly tags?: Readonly<Record<string, string>> | undefined
  /** Gateway to route through; Workers AI models require it. */
  readonly gatewayId?: string | undefined
  /** Gateway-side request timeout, in milliseconds. */
  readonly requestTimeoutMs?: number | undefined
}

/** Raised when more metadata is supplied than the gateway will keep. */
export class TooMuchMetadataError extends Error {
  override readonly name = 'TooMuchMetadataError'
  constructor(count: number) {
    super(
      `cf-aig-metadata accepts at most ${MAX_METADATA_ENTRIES} entries and ${count} were supplied. ` +
        'The gateway drops the excess silently, which would break session cost attribution. ' +
        'Reduce `tags` on the cloudflare-llm plugin.',
    )
  }
}

/** Inputs the header builder reads from the in-flight request. */
export interface RequestIdentity {
  readonly sessionId?: string | undefined
  readonly purpose?: string | undefined
}

/**
 * Build the metadata object for one request.
 *
 * Undefined entries are dropped so the serialized header carries only facts.
 */
export function buildGatewayMetadata(
  identity: RequestIdentity,
  tags: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const metadata: Record<string, string> = {}
  // Tags first, then the identity keys, so a tag can never displace the session
  // id — it is the one entry the cost feature cannot do without.
  for (const [key, value] of Object.entries(tags ?? {})) metadata[key] = value
  if (identity.sessionId !== undefined) metadata[SESSION_METADATA_KEY] = identity.sessionId
  if (identity.purpose !== undefined) metadata[PURPOSE_METADATA_KEY] = identity.purpose
  const count = Object.keys(metadata).length
  if (count > MAX_METADATA_ENTRIES) throw new TooMuchMetadataError(count)
  return metadata
}

/**
 * Build the `cf-aig-*` headers for one request.
 *
 * Only headers with a value are emitted: an absent option must leave gateway
 * defaults alone rather than overriding them with a neutral value.
 */
export function buildGatewayHeaders(
  identity: RequestIdentity,
  options: GatewayHeaderOptions,
): Record<string, string> {
  const headers: Record<string, string> = {}

  const metadata = buildGatewayMetadata(identity, options.tags)
  if (Object.keys(metadata).length > 0) {
    headers['cf-aig-metadata'] = JSON.stringify(metadata)
  }
  // Zero means "no opinion", not "cache for zero seconds": sending it would
  // override whatever the gateway itself is configured to do, which is the
  // opposite of leaving defaults alone.
  const cacheTtl = options.cacheTtlSeconds ?? 0
  if (cacheTtl > 0) {
    headers['cf-aig-cache-ttl'] = String(cacheTtl)
  }
  if (options.skipCache === true) {
    headers['cf-aig-skip-cache'] = 'true'
  }
  if (options.customCost !== undefined) {
    headers['cf-aig-custom-cost'] = JSON.stringify({
      per_token_in: options.customCost.perTokenIn,
      per_token_out: options.customCost.perTokenOut,
    })
  }
  if (options.collectLog !== undefined) {
    headers['cf-aig-collect-log'] = String(options.collectLog)
  }
  // Workers AI models are documented as *always* requiring this header; for
  // third-party models it selects a gateway instead of falling back to the
  // account's `default` one. Absent from the OpenAPI schema and the SDK, so it
  // goes on as a raw header.
  if (options.gatewayId !== undefined && options.gatewayId !== '') {
    headers['cf-aig-gateway-id'] = options.gatewayId
  }
  const gatewayTimeout = options.requestTimeoutMs ?? 0
  if (gatewayTimeout > 0) {
    headers['cf-aig-request-timeout'] = String(gatewayTimeout)
  }
  // `cf-aig-max-attempts`, `cf-aig-retry-delay` and `cf-aig-backoff` are
  // deliberately never sent. They make the gateway retry on the adapter's
  // behalf, which would break the harness contract that one adapter call is one
  // provider attempt — the harness owns retry policy, and a hidden second
  // attempt would be billed and logged as a separate request.
  return headers
}
