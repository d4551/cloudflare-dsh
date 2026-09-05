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

/** Gateway behaviour this adapter can request per call. */
export interface GatewayHeaderOptions {
  /** Seconds to cache an identical request; 0 disables caching. */
  readonly cacheTtlSeconds?: number | undefined
  /** Bypass the cache for this request. */
  readonly skipCache?: boolean | undefined
  /** Override the cost Cloudflare records for this request. */
  readonly customCost?: number | undefined
  /** Whether the gateway should store request and response bodies. */
  readonly collectLog?: boolean | undefined
  /** Static tags merged into the metadata. */
  readonly tags?: Readonly<Record<string, string>> | undefined
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
  for (const [key, value] of Object.entries(tags ?? {})) metadata[key] = value
  if (identity.sessionId !== undefined) metadata['sessionId'] = identity.sessionId
  if (identity.purpose !== undefined) metadata['purpose'] = identity.purpose
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
    headers['cf-aig-custom-cost'] = String(options.customCost)
  }
  if (options.collectLog !== undefined) {
    headers['cf-aig-collect-log'] = String(options.collectLog)
  }
  return headers
}
