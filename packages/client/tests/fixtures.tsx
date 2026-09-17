/**
 * One definition of every fixture the client's lanes share.
 *
 * These props had drifted into four copies — the session usage in four files,
 * the settings in four, the settled block in two — so a change to a fixture
 * reached one lane and left the others rendering props nobody ships. One module
 * describes the surfaces now: the accessibility scan, the server-render
 * contract, the interaction lane and the layout lane all read it, and a state
 * added here is a state every lane exercises.
 *
 * Nothing here reaches for a browser API, a network or a file system, so it
 * loads in each environment these lanes run in.
 */
import type { JSX } from 'react'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { SettingsCard } from '../src/SettingsCard.tsx'
import type { AxNode, CloudflareSettings, D1ResultSet, SessionUsage, SlotComponent } from '../src/index.ts'
import { AccessibilityTree } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'
import {
  AccessibilityTreeToolView,
  BrowserRenderToolView,
  D1ResultToolView,
  SessionCostToolView,
  type ToolCallOwnerProps,
} from '../src/toolviews/fromToolCall.tsx'

/** A session's gateway usage, as `cloudflare_aigateway_session_cost` returns it. */
const USAGE: SessionUsage = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }

/** The settings a host hands the card, holding the reference a reader would keep. */
export const SETTINGS: CloudflareSettings = {
  apiTokenRef: 'CLOUDFLARE_API_TOKEN',
  accountId: '',
  gatewayId: '',
}

/** An accessibility tree one level deep, so nesting is rendered rather than described. */
const TREE: AxNode = {
  role: 'document',
  name: 'Page',
  children: [{ role: 'heading', name: 'Title' }],
}

/** Two rows across two columns, the shape a query's view is read from. */
const ROWS: readonly D1ResultSet[] = [
  {
    results: [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ],
  },
]

/** `n` rows, so the render cap can be approached from either side of it. */
const rows = (n: number): readonly D1ResultSet[] => [
  { results: Array.from({ length: n }, (_, index) => ({ id: index })) },
]

/**
 * One content block of a tool result.
 *
 * A type alias and not an interface, for the reason every block shape in this
 * module carries: an interface gets no implicit index signature, so a value
 * declared as one cannot be handed over where a wire value is expected — and
 * these are, as the content of a settled block.
 */
type ContentPart = {
  readonly type: string
  readonly text?: string | undefined
}

/** A block carrying text and no type: a real host writes one, and no view can read it. */
type UntypedPart = {
  readonly text: string
}

/** Anything a result's content list can carry, malformed entries included. */
export type BlockPart = ContentPart | UntypedPart | string | number | null | undefined

/** What a tool publishes as its view projection, malformed values included. */
export type Projection =
  | undefined
  | string
  | number
  | boolean
  | null
  | readonly Projection[]
  | { readonly [key: string]: Projection }

/**
 * A settled result block, tagged the way only that arm of the block is.
 *
 * A type alias for the reason `ContentPart` states: `ownerCurrency` hands this
 * one to `ToolCallOwnerProps`, which takes wire values.
 */
export type SettledBlock = {
  readonly kind: 'tool-result'
  readonly isError: boolean
  readonly content: readonly BlockPart[]
  readonly meta: Projection
}

/**
 * A call the host has not settled: a running block carries no tag at all.
 *
 * A type alias for the reason above: `ownerCurrency` hands it over the same way.
 */
export type RunningBlock = {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
}

/** Build a settled result carrying one tool's projection. */
export const settledBlock = (
  meta: Projection,
  content: readonly BlockPart[] = [],
  isError = false,
): SettledBlock => ({ kind: 'tool-result', isError, content, meta })

/** A call still running, as `ToolCallBlock` carries one. */
const runningBlock = (): RunningBlock => ({
  callId: 'call-1',
  name: 'cloudflare_d1_query',
  argsRaw: '{}',
})

/** The owner currency a tool-view slot hands the view it registered. */
export const ownerCurrency = (
  block: SettledBlock | RunningBlock,
  toolName = 'cloudflare_d1_query',
): ToolCallOwnerProps => ({ callId: 'call-1', toolName, block })

/**
 * A settled result whose projection no view could read.
 *
 * A session log written before a tool published its projection replays as
 * exactly this: a result carrying text and no shape, which is the one path the
 * plain-text card is reached through.
 */
const UNREADABLE: SettledBlock = settledBlock(undefined, [{ type: 'text', text: 'id\n1' }])

/** The chip showing a session's usage, the state its toggle is reached from. */
export const CHIP_WITH_USAGE = <SessionCostChip usage={USAGE} />

/** The card with a token already stored, the state its save control is reached from. */
export const CARD_TOKEN_STORED = <SettingsCard settings={SETTINGS} tokenStored onSave={() => undefined} />

const CHIP_LOADING = <SessionCostChip loading />
const CHIP_FAILED = <SessionCostChip failed />
const CHIP_EMPTY = <SessionCostChip />
const CARD_UNSTORED = <SettingsCard settings={SETTINGS} tokenStored={false} onSave={() => undefined} />
const D1_ROWS = <D1Result sql="SELECT id, name FROM users" resultSets={ROWS} />
const D1_EMPTY = <D1Result sql="SELECT 1" resultSets={[]} />
const D1_CAPPED = <D1Result sql="SELECT id FROM events" resultSets={rows(4312)} />
const RENDER = <BrowserRender url="https://example.test" body="# Title" />
const TREE_NESTED = <AccessibilityTree url="https://example.test" tree={TREE} />
const TREE_LEAF = <AccessibilityTree url="https://example.test" tree={{ role: 'document' }} />
const D1_VIEW = (
  <D1ResultToolView
    {...ownerCurrency(settledBlock({ sql: 'SELECT id, name FROM users', resultSets: ROWS }))}
  />
)
const D1_VIEW_TEXT = <D1ResultToolView {...ownerCurrency(UNREADABLE)} />
const RENDER_VIEW = (
  <BrowserRenderToolView {...ownerCurrency(settledBlock({ url: 'https://example.test', body: '# Title' }))} />
)
const RENDER_VIEW_TEXT = <BrowserRenderToolView {...ownerCurrency(UNREADABLE)} />
const TREE_VIEW = (
  <AccessibilityTreeToolView {...ownerCurrency(settledBlock({ url: 'https://example.test', tree: TREE }))} />
)
const TREE_VIEW_TEXT = <AccessibilityTreeToolView {...ownerCurrency(UNREADABLE)} />
const COST_VIEW = <SessionCostToolView {...ownerCurrency(settledBlock(USAGE))} />
const COST_VIEW_RUNNING = <SessionCostToolView {...ownerCurrency(runningBlock())} />

/** One surface the package renders, in one state its props can put it in. */
export interface Surface {
  /** A label a failure names. */
  readonly name: string
  /** The component this entry covers, so coverage can be stated against it. */
  readonly component: SlotComponent
  /** The element a lane renders. */
  readonly element: JSX.Element
}

/**
 * Every surface this package exports, in every state a prop can put it in.
 *
 * A lane that renders this list renders the whole client: the accessibility
 * scan walks each entry, the server-render contract renders each entry twice
 * and compares the bytes, and the layout lane measures each one in Chromium.
 * A state added here is therefore a state every lane sees, which is the point
 * of one list over four.
 *
 * The two states this list cannot carry are the ones a prop cannot reach —
 * the chip's expanded detail and the settings card's validation error are both
 * internal state a reader reaches by activating a control. Those are covered
 * by the interaction lane, which drives the control and reads the result.
 */
export const SURFACES: readonly Surface[] = [
  { name: 'SessionCostChip', component: SessionCostChip, element: CHIP_WITH_USAGE },
  { name: 'SessionCostChip (loading)', component: SessionCostChip, element: CHIP_LOADING },
  { name: 'SessionCostChip (failed)', component: SessionCostChip, element: CHIP_FAILED },
  { name: 'SessionCostChip (empty)', component: SessionCostChip, element: CHIP_EMPTY },
  { name: 'SettingsCard (token stored)', component: SettingsCard, element: CARD_TOKEN_STORED },
  { name: 'SettingsCard (no token stored)', component: SettingsCard, element: CARD_UNSTORED },
  { name: 'D1Result', component: D1Result, element: D1_ROWS },
  { name: 'D1Result (empty)', component: D1Result, element: D1_EMPTY },
  { name: 'D1Result (capped)', component: D1Result, element: D1_CAPPED },
  { name: 'BrowserRender', component: BrowserRender, element: RENDER },
  { name: 'AccessibilityTree', component: AccessibilityTree, element: TREE_NESTED },
  { name: 'AccessibilityTree (leaf)', component: AccessibilityTree, element: TREE_LEAF },
  { name: 'D1ResultToolView', component: D1ResultToolView, element: D1_VIEW },
  { name: 'D1ResultToolView (no projection)', component: D1ResultToolView, element: D1_VIEW_TEXT },
  { name: 'BrowserRenderToolView', component: BrowserRenderToolView, element: RENDER_VIEW },
  {
    name: 'BrowserRenderToolView (no projection)',
    component: BrowserRenderToolView,
    element: RENDER_VIEW_TEXT,
  },
  { name: 'AccessibilityTreeToolView', component: AccessibilityTreeToolView, element: TREE_VIEW },
  {
    name: 'AccessibilityTreeToolView (no projection)',
    component: AccessibilityTreeToolView,
    element: TREE_VIEW_TEXT,
  },
  { name: 'SessionCostToolView', component: SessionCostToolView, element: COST_VIEW },
  { name: 'SessionCostToolView (running)', component: SessionCostToolView, element: COST_VIEW_RUNNING },
]

/**
 * The tree a host assembles out of the slots, in one React tree.
 *
 * One tree, not a join of separately rendered strings: `useId` mints ids per
 * render, so rendering each surface alone and concatenating would restart the
 * counter and manufacture id collisions no host produces.
 *
 * The chip and the settings card are singletons — one session header, one
 * settings page — while a tool view is rendered once per tool call, so the
 * repeating cards appear twice. That repetition is what a conversation running
 * the same query twice produces, and it is what tells a card that ships a
 * landmark name it cannot share from one that does not.
 */
export const HOST_COMPOSITION: JSX.Element = (
  <>
    {CHIP_WITH_USAGE}
    {CARD_TOKEN_STORED}
    {D1_ROWS}
    {D1_ROWS}
    {RENDER}
    {RENDER}
    {TREE_NESTED}
    {TREE_NESTED}
    {D1_VIEW_TEXT}
    {D1_VIEW_TEXT}
  </>
)
