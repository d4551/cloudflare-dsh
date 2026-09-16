/**
 * Adapting a harness tool-call block into the props a tool view takes.
 *
 * A component registered into `tool.call.toolview` is not handed the tool's
 * result. It is handed the slot's owner currency — the call id, the wire tool
 * name and the running-or-settled block — so a presentational component whose
 * props are `{ sql, resultSets }` receives none of what it declares. That gap
 * is what this module closes.
 *
 * The structured value reaches the client through `output.presentationMeta`:
 * each tool projects the fields its view needs, the harness persists that
 * projection with the session log, and it arrives here as the settled block's
 * `meta` on live and replay paths alike. The model-facing render text cannot
 * carry these shapes losslessly, which is exactly what that projection is for.
 *
 * Everything read here is a wire value (`../wire.ts`): the block and the
 * projection inside it are what the session log round-trips, so the types below
 * say what the data is, and each field is read and checked before it is used.
 *
 * The shapes below are structural, and not invented: they are read from the
 * published declarations of `@deepseek-ai/dsh-client-ui-tool`'s
 * `ToolCallOwnerProps` and `@deepseek-ai/dsh-client-runtime`'s `ToolCallBlock`
 * (`RunningToolCall | ToolResultNode`). Importing them is not possible —
 * `ToolCallViewProps` is not exported from the package root, and the packages'
 * declarations do not typecheck with `skipLibCheck` off — so the contract suite
 * pins what the compiler cannot check. Only the fields this package reads are
 * declared; a running call carries no `kind`, which is what tells the two apart.
 */

import { useId } from 'react'
import { SessionCostChip } from '../SessionCostChip.tsx'
import { en } from '../locales/en.ts'
import type { SessionUsage } from '../format.ts'
import { isWireArray, isWireObject, type WireValue } from '../wire.ts'
import { AccessibilityTree, type AxNode } from './AccessibilityTree.tsx'
import { BrowserRender } from './BrowserRender.tsx'
import { D1Result, type D1ResultSet } from './D1Result.tsx'

/**
 * One content block of a tool result, as the harness carries it.
 *
 * A type alias rather than an interface, because it is narrowed out of a wire
 * list: the predicate that narrows it has to name a type that can itself be a
 * wire value.
 */
export type ToolTextBlock = {
  readonly type: string
  readonly text?: string
}

/**
 * The settled arm of a tool-call block: the result node, as this package reads
 * it. It carries what was read, not the tag it was matched on.
 */
export interface ToolResultBlock {
  /** The tool's `presentationMeta` projection, replayed from the session log. */
  readonly meta?: WireValue
  readonly isError: boolean
  readonly content: readonly ToolTextBlock[]
}

/**
 * The owner currency every registered tool view is given.
 *
 * `callId`, `toolName`, `cwd`, `openFile` and `inspect` travel with it and are
 * declared so the shape is the host's rather than a subset invented here; this
 * package's views need only the block.
 */
export interface ToolCallOwnerProps {
  readonly callId: string
  readonly toolName: string
  readonly block: WireValue
  readonly cwd?: string | undefined
  readonly openFile?: ((path: string) => void) | undefined
  readonly inspect?: (() => void) | undefined
}

/** Whether a content block is one carrying the type a view reads it by. */
function isTextBlock(value: WireValue): value is ToolTextBlock {
  if (!isWireObject(value) || typeof value['type'] !== 'string') return false
  const text = value['text']
  return text === undefined || typeof text === 'string'
}

/**
 * The settled result behind a block, or undefined while the call is running.
 *
 * A running call carries no `kind`; only the result node does, so the tag is
 * what tells the two apart rather than the absence of a field.
 *
 * The narrowed value is built rather than asserted. A cast here would claim a
 * shape the compiler cannot see and this package cannot import, which is the
 * one thing a structural model must not do — the fields are read and checked.
 */
export function settledResult(block: WireValue): ToolResultBlock | undefined {
  if (!isWireObject(block) || block['kind'] !== 'tool-result') return undefined
  const content = block['content']
  return {
    meta: block['meta'],
    isError: block['isError'] === true,
    content: isWireArray(content) ? content.filter(isTextBlock) : [],
  }
}

/** The projection a tool published for its view, or undefined when there is none. */
export function presentationMetaOf(block: WireValue): WireValue {
  return settledResult(block)?.meta
}

/** The text a tool result carries, for a view that cannot read the projection. */
export function resultText(block: WireValue): string {
  const settled = settledResult(block)
  if (settled === undefined) return ''
  return settled.content
    .flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []))
    .join('\n')
}

/**
 * A settled result the projection could not be read from, as plain text.
 *
 * Built like `BrowserRender`, because it is the same thing: a box that scrolls
 * its own overflow. That makes `tabIndex` a requirement rather than a
 * decoration — without it a keyboard user cannot reach the scroll at all
 * (SC 2.1.1) — and it makes the figure's name come from a caption, since
 * `aria-label` on a `<pre>` addresses the `generic` role ARIA prohibits naming.
 * A figure rather than a section, because tool views repeat and two identically
 * named landmarks is a `landmark-unique` violation.
 *
 * It was a bare `<pre>` with neither, and no fixture rendered it, so no lane
 * ever laid it out: the reflow lane listed it among the containers allowed to
 * scroll and never saw one.
 */
function ToolResultFallback({
  block,
  toolName,
}: {
  readonly block: WireValue
  readonly toolName: string
}): React.JSX.Element | null {
  const captionId = useId()
  // Nothing while the call runs: the host draws its own pending card, and a
  // second empty one under it says less than nothing.
  if (settledResult(block) === undefined) return null
  return (
    <figure className="cf-toolview" tabIndex={0} aria-labelledby={captionId}>
      <figcaption id={captionId} className="cf-toolview__caption">
        {en.toolView.rawHeading(toolName)}
      </figcaption>
      <pre className="cf-toolview__raw">{resultText(block)}</pre>
    </figure>
  )
}

/** The projection `cloudflare_d1_query` publishes: the query and its row sets. */
type D1Projection = { readonly sql: string; readonly resultSets: readonly D1ResultSet[] }

/** The projection `cloudflare_browser_render` publishes: a page and its text. */
type RenderProjection = { readonly url: string; readonly body: string }

/** The projection `cloudflare_browser_accessibility_tree` publishes. */
type TreeProjection = { readonly url: string; readonly tree: AxNode }

/**
 * Whether an entry is a result set, rows included.
 *
 * The rows are checked one at a time: the table view reads each of them by name,
 * and a value that holds none of what it reads belongs on the plain-text card.
 */
function isResultSet(value: WireValue): value is D1ResultSet {
  if (!isWireObject(value)) return false
  const rows = value['results']
  return rows === undefined || (isWireArray(rows) && rows.every(isWireObject))
}

/** Whether every entry of a list is a result set. */
function isResultSets(value: WireValue): value is readonly D1ResultSet[] {
  return isWireArray(value) && value.every(isResultSet)
}

/**
 * Whether a value is one node of an accessibility tree.
 *
 * Recursive, because the tree is: a node whose children are rendered has to
 * have children this view can render, and `describeNode` reads `role` and `name`
 * as text. A node that fails this check sends the whole projection to the
 * plain-text card, where the reader still sees what came back.
 */
function isAxNode(value: WireValue): value is AxNode {
  if (!isWireObject(value)) return false
  const role = value['role']
  const name = value['name']
  const children = value['children']
  return (
    (role === undefined || typeof role === 'string') &&
    (name === undefined || typeof name === 'string') &&
    (children === undefined || (isWireArray(children) && children.every(isAxNode)))
  )
}

/** Projection `cloudflare_d1_query` publishes for its view. */
function isD1Meta(value: WireValue): value is D1Projection {
  return isWireObject(value) && typeof value['sql'] === 'string' && isResultSets(value['resultSets'])
}

/** Projection `cloudflare_browser_render` publishes for its view. */
function isRenderMeta(value: WireValue): value is RenderProjection {
  return isWireObject(value) && typeof value['url'] === 'string' && typeof value['body'] === 'string'
}

/** Projection `cloudflare_browser_accessibility_tree` publishes for its view. */
function isTreeMeta(value: WireValue): value is TreeProjection {
  return isWireObject(value) && typeof value['url'] === 'string' && isAxNode(value['tree'])
}

/** Projection `cloudflare_aigateway_session_cost` publishes for its view. */
function isUsageMeta(value: WireValue): value is SessionUsage {
  return (
    isWireObject(value) &&
    typeof value['requests'] === 'number' &&
    typeof value['cost'] === 'number' &&
    typeof value['tokensIn'] === 'number' &&
    typeof value['tokensOut'] === 'number' &&
    typeof value['cached'] === 'number'
  )
}

/** `cloudflare_d1_query` as a table, from the block the host supplies. */
export function D1ResultToolView({ block, toolName }: ToolCallOwnerProps): React.JSX.Element | null {
  const meta = presentationMetaOf(block)
  if (!isD1Meta(meta)) return <ToolResultFallback block={block} toolName={toolName} />
  return <D1Result sql={meta.sql} resultSets={meta.resultSets} />
}

/** `cloudflare_browser_render` as captioned text, from the block the host supplies. */
export function BrowserRenderToolView({ block, toolName }: ToolCallOwnerProps): React.JSX.Element | null {
  const meta = presentationMetaOf(block)
  if (!isRenderMeta(meta)) return <ToolResultFallback block={block} toolName={toolName} />
  return <BrowserRender url={meta.url} body={meta.body} />
}

/** `cloudflare_browser_accessibility_tree` as nested lists, from the host's block. */
export function AccessibilityTreeToolView({ block, toolName }: ToolCallOwnerProps): React.JSX.Element | null {
  const meta = presentationMetaOf(block)
  if (!isTreeMeta(meta)) return <ToolResultFallback block={block} toolName={toolName} />
  return <AccessibilityTree url={meta.url} tree={meta.tree} />
}

/**
 * `cloudflare_aigateway_session_cost` as the usage chip.
 *
 * The chip already renders exactly this tool's output — `SessionUsage` is
 * documented as the shape that tool returns — and was contributed to one slot
 * only. Its loading and failed states are the running call and the failed one,
 * so the states it was built with are the states a tool call actually has.
 */
export function SessionCostToolView({ block }: ToolCallOwnerProps): React.JSX.Element {
  const settled = settledResult(block)
  if (settled === undefined) return <SessionCostChip loading />
  const meta = settled.meta
  if (!isUsageMeta(meta)) return <SessionCostChip failed />
  return <SessionCostChip usage={meta} />
}
