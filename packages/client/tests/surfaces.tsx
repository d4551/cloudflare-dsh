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
const css = readFileSync(fileURLToPath(new URL('../src/cloudflare.css', import.meta.url)), 'utf8')

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

/** How a page is opened: colour scheme, and the viewport it is laid out for. */
export interface PageOptions {
  readonly scheme: 'light' | 'dark'
  readonly viewport?: { readonly width: number; readonly height: number } | undefined
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
  })
  const page = await context.newPage()
  // These are fragments that live inside a host page, so the fixture supplies
  // what a host would: the viewport meta a mobile layout depends on, landmarks,
  // a page heading, and readable chrome colours. Page-scoped rules must fail on
  // a real defect, not on an unrealistic harness — and the fix for that is a
  // better fixture, not a filtered rule set.
  const fg = options.scheme === 'dark' ? '#f2f3f5' : '#16181d'
  const bg = options.scheme === 'dark' ? '#16181d' : '#ffffff'
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>Cloudflare surfaces</title>` +
      `<style>body{margin:0;color:${fg};background:${bg}}${css}</style>` +
      `</head><body><header><h1>Cloudflare surfaces</h1></header>` +
      `<main>${markup}</main></body></html>`,
  )
  return { page, context }
}
