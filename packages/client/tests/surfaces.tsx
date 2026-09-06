/**
 * The surfaces this package contributes, as a host would assemble them.
 *
 * Shared by the browser lanes so the accessibility scan and the viewport scan
 * look at the same markup. Two lanes rendering two slightly different pages
 * would be two claims about two things.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { SettingsCard } from '../src/SettingsCard.tsx'
import { AccessibilityTree } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'

/** The stylesheet the package ships, read rather than reconstructed. */
export const css = readFileSync(fileURLToPath(new URL('../src/cloudflare.css', import.meta.url)), 'utf8')

const usage = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }
const settings = { apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: '', gatewayId: '' }
const tree = { role: 'document', name: 'Page', children: [{ role: 'heading', name: 'Title' }] }

/**
 * Every state each surface can be rendered into from its props.
 *
 * Not one state per component: the empty, loading and failed chips and the
 * empty result each render copy no other state renders, and a scan of the
 * happy path alone never sees them.
 */
export const STATES: ReadonlyArray<{ name: string; element: React.JSX.Element }> = [
  { name: 'SessionCostChip', element: <SessionCostChip usage={usage} /> },
  { name: 'SessionCostChip (empty)', element: <SessionCostChip /> },
  { name: 'SessionCostChip (loading)', element: <SessionCostChip loading /> },
  { name: 'SessionCostChip (failed)', element: <SessionCostChip failed /> },
  {
    name: 'SettingsCard',
    element: <SettingsCard settings={settings} tokenStored onSave={() => undefined} />,
  },
  {
    name: 'SettingsCard (no token stored)',
    element: <SettingsCard settings={settings} tokenStored={false} onSave={() => undefined} />,
  },
  {
    name: 'D1Result',
    element: <D1Result sql="SELECT id, name FROM users" resultSets={[{ results: [{ id: 1, name: 'a' }] }]} />,
  },
  { name: 'D1Result (empty)', element: <D1Result sql="SELECT 1" resultSets={[]} /> },
  { name: 'BrowserRender', element: <BrowserRender url="https://example.test" body="# Title" /> },
  { name: 'AccessibilityTree', element: <AccessibilityTree url="https://example.test" tree={tree} /> },
  {
    name: 'AccessibilityTree (leaf)',
    element: <AccessibilityTree url="https://example.test" tree={{ role: 'document' }} />,
  },
]

/**
 * The client as a host assembles it, in one React tree.
 *
 * One call, not a join of many: `useId` mints ids per render, so rendering
 * each surface separately and concatenating would restart the counter and
 * manufacture id collisions no host would ever produce.
 *
 * The composition is the real one, which is the point of scanning it. The chip
 * and the settings card are singletons — one session header, one settings tab
 * — while a tool view is rendered once per tool call, so each appears twice
 * with identical props. That repetition is what a conversation running the
 * same query twice produces, and it is what caught the tool views being
 * `region` landmarks: two cards, one name, one `landmark-unique` violation.
 */
export const ASSEMBLED = renderToStaticMarkup(
  <>
    <SessionCostChip usage={usage} />
    <SettingsCard settings={settings} tokenStored onSave={() => undefined} />
    <D1Result sql="SELECT id FROM users" resultSets={[{ results: [{ id: 1 }] }]} />
    <D1Result sql="SELECT id FROM users" resultSets={[{ results: [{ id: 1 }] }]} />
    <BrowserRender url="https://example.test" body="# Title" />
    <BrowserRender url="https://example.test" body="# Title" />
    <AccessibilityTree url="https://example.test" tree={tree} />
    <AccessibilityTree url="https://example.test" tree={tree} />
  </>,
)

/**
 * A wide result set and a long rendered body.
 *
 * The ordinary fixtures are small enough to fit any viewport, which makes them
 * useless for asking whether a narrow one reflows: a two-column table never
 * overflows, so a scroll container that does not work looks identical to one
 * that does.
 */
export const OVERFLOWING = renderToStaticMarkup(
  <>
    <D1Result
      sql="SELECT id, email, created_at, last_seen_at, plan, region FROM users"
      resultSets={[
        {
          results: [
            {
              id: 1,
              email: 'someone.with.a.long.address@example.test',
              created_at: '2026-01-01T00:00:00Z',
              last_seen_at: '2026-09-01T00:00:00Z',
              plan: 'enterprise',
              region: 'weur',
            },
          ],
        },
      ]}
    />
    <BrowserRender
      url="https://example.test/a/rather/long/path/that/will/not/wrap"
      body={`# Title\n${'no-spaces-in-this-line-so-it-cannot-wrap-'.repeat(8)}`}
    />
  </>,
)

export const THEMES: ReadonlyArray<{ name: string; scheme: 'light' | 'dark' }> = [
  { name: 'light', scheme: 'light' },
  { name: 'dark', scheme: 'dark' },
]

/**
 * Prefer a Chromium the environment has already provisioned.
 *
 * Some sandboxes ship a browser at a fixed path whose build does not match the
 * revision this Playwright would download; using it avoids a download that the
 * network policy may not allow. Falls back to Playwright's own resolution, so
 * CI behaves normally.
 */
const PROVIDED_CHROMIUM = '/opt/pw-browsers/chromium'

/** Launch the browser both lanes drive. */
export function launch(): Promise<Browser> {
  return chromium.launch(existsSync(PROVIDED_CHROMIUM) ? { executablePath: PROVIDED_CHROMIUM } : {})
}

/**
 * What a page may declare as its own colour scheme.
 *
 * The whole legal set for a fixture: accept both and defer to the reader's
 * system, name one and decide, or say nothing and take the initial value.
 */
export type HostScheme = 'light dark' | 'light' | 'dark' | 'normal'

/**
 * The document a host would serve, around whatever it puts in `<main>`.
 *
 * One host for every browser lane, because two lanes rendering two slightly
 * different pages would be two claims about two things — and because the host
 * is itself under test. It supplies what a real one supplies: the viewport meta
 * a mobile layout depends on, landmarks, a page heading, and a colour scheme
 * declared the way pages declare one. `hostScheme` is that declaration, so a
 * test can put it at odds with the operating system preference; the chrome
 * colours are read back out of it with `light-dark()` rather than branched on,
 * so the page cannot disagree with itself.
 *
 * Page-scoped rules must fail on a real defect, not on an unrealistic harness
 * — and the fix for that is a better fixture, not a filtered rule set.
 */
export function hostPage(main: string, hostScheme: HostScheme): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Cloudflare surfaces</title><style>` +
    `:root{color-scheme:${hostScheme}}` +
    `body{margin:0;color:light-dark(#16181d,#f2f3f5);background:light-dark(#ffffff,#16181d)}` +
    `${css}</style></head><body><header><h1>Cloudflare surfaces</h1></header>` +
    `<main>${main}</main></body></html>`
  )
}

/** How a page is opened: colour scheme, and the viewport it is laid out for. */
export interface PageOptions {
  readonly scheme: 'light' | 'dark'
  readonly viewport?: { readonly width: number; readonly height: number } | undefined
  /**
   * What the host declares as its own `color-scheme`.
   *
   * Defaults to accepting both, which is what a page that follows the reader's
   * preference declares. Pinning it to one while `scheme` says the other is how
   * a test asks whose choice these fragments actually follow.
   */
  readonly hostScheme?: HostScheme | undefined
  /**
   * Emulate a touch pointer, which is what makes `(pointer: coarse)` match.
   *
   * Measured rather than assumed: `hasTouch` is the only context option that
   * flips it — `isMobile` alone leaves the pointer fine, so a lane that set
   * only a phone-sized viewport was still testing a mouse.
   */
  readonly touch?: boolean | undefined
  /** Emulate Windows high contrast, which replaces every colour the page chose. */
  readonly forcedColors?: 'active' | undefined
}

/**
 * Load markup into a page with the shipped stylesheet applied.
 *
 * The page comes from an explicit context because `@axe-core/playwright`
 * requires one, and because the viewport is a context property.
 */
export async function open(
  browser: Browser,
  markup: string,
  options: PageOptions,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    colorScheme: options.scheme,
    ...(options.viewport === undefined ? {} : { viewport: options.viewport }),
    ...(options.touch === undefined ? {} : { hasTouch: options.touch }),
    ...(options.forcedColors === undefined ? {} : { forcedColors: options.forcedColors }),
  })
  const page = await context.newPage()
  await page.setContent(hostPage(markup, options.hostScheme ?? 'light dark'))
  return { page, context }
}
