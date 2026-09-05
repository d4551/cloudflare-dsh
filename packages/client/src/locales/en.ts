/**
 * User-facing copy.
 *
 * Routed through a typed dictionary rather than written inline, matching the
 * harness's own client convention and keeping every string in one reviewable
 * place — including the accessible names, which are part of the interface, not
 * decoration.
 */
export const en = {
  cost: {
    label: 'Cloudflare AI Gateway usage for this session',
    requests: (n: number) => `${n} ${n === 1 ? 'request' : 'requests'}`,
    cost: (amount: string) => `cost ${amount}`,
    cached: (n: number) => `${n} served from cache`,
    cacheRate: (percent: string) => `${percent} cache hit rate`,
    tokens: (input: number, output: number) => `${input} in, ${output} out`,
    empty: 'No Cloudflare AI Gateway requests recorded for this session yet.',
    loading: 'Loading Cloudflare usage for this session',
    error: 'Cloudflare usage could not be loaded.',
  },
  settings: {
    heading: 'Cloudflare',
    description:
      'Credentials are stored by reference. This page never receives a stored secret back — only whether one is set.',
    tokenRefLabel: 'API token reference',
    tokenRefHint: 'The environment variable name holding the token, for example CLOUDFLARE_API_TOKEN.',
    tokenValueLabel: 'API token',
    tokenValueHint: 'Write-only. Leave blank to keep the stored value.',
    accountLabel: 'Account ID',
    accountHint: 'Leave blank to use the first account the token can access.',
    gatewayLabel: 'AI Gateway ID',
    gatewayHint: 'Required to route the harness’s own model calls through a gateway.',
    tokenSet: 'A token is stored for this reference.',
    tokenUnset: 'No token is stored for this reference.',
    save: 'Save Cloudflare settings',
    saved: 'Cloudflare settings saved.',
    invalidTokenRef:
      'A token reference must be an environment variable name: uppercase letters, digits and underscores.',
  },
  toolView: {
    renderHeading: (url: string) => `Rendered ${url}`,
    treeHeading: (url: string) => `Accessibility tree for ${url}`,
    queryCaption: (sql: string) => `Results for query: ${sql}`,
    emptyResult: 'The query returned no rows.',
    screenshotAlt: (url: string) => `Screenshot of ${url}`,
  },
}

/** The dictionary shape, so alternative locales stay structurally compatible. */
export type Locale = typeof en
