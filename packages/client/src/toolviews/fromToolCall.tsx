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
 * The shapes below are structural, and not invented: they are read from the
 * published declarations of `@deepseek-ai/dsh-client-ui-tool`'s
 * `ToolCallOwnerProps` and `@deepseek-ai/dsh-client-runtime`'s `ToolCallBlock`
 * (`RunningToolCall | ToolResultNode`). Importing them is not possible —
 * `ToolCallViewProps` is not exported from the package root, and the packages'
 * declarations do not typecheck with `skipLibCheck` off — so the contract suite
 * pins what the compiler cannot check. Only the fields this package reads are
 * declared; a running call carries no `kind`, which is what tells the two apart.
 */

import { SessionCostChip } from '../SessionCostChip.tsx'
import type { SessionUsage } from '../format.ts'
import { AccessibilityTree, type AxNode } from './AccessibilityTree.tsx'
import { BrowserRender } from './BrowserRender.tsx'
import { D1Result, type D1ResultSet } from './D1Result.tsx'

/** One content block of a tool result, as the harness carries it. */
export interface ToolTextBlock {
  readonly type: string
  readonly text?: string
}

/**
 * The settled arm of a tool-call block: the result node, as this package reads
 * it. It carries what was read, not the tag it was matched on.
 */
export interface ToolResultBlock {
  /** The tool's `presentationMeta` projection, replayed from the session log. */
  readonly meta?: unknown
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
  readonly block: unknown
  readonly cwd?: string | undefined
  readonly openFile?: ((path: string) => void) | undefined
  readonly inspect?: (() => void) | undefined
}

/** Whether a value is a non-null object, so its properties can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Whether a content block is one carrying text. */
function isTextBlock(value: unknown): value is ToolTextBlock {
  return isRecord(value) && typeof value['type'] === 'string'
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
export function settledResult(block: unknown): ToolResultBlock | undefined {
  if (!isRecord(block) || block['kind'] !== 'tool-result') return undefined
  const content = block['content']
  return {
    meta: block['meta'],
    isError: block['isError'] === true,
    content: Array.isArray(content) ? content.filter(isTextBlock) : [],
  }
}

/** The projection a tool published for its view, or undefined when there is none. */
export function presentationMetaOf(block: unknown): unknown {
  return settledResult(block)?.meta
}

/** The text a tool result carries, for a view that cannot read the projection. */
export function resultText(block: unknown): string {
  const settled = settledResult(block)
  if (settled === undefined) return ''
  return settled.content
    .flatMap((part) => (part.type === 'text' && part.text !== undefined ? [part.text] : []))
    .join('\n')
}

/** A settled result the projection could not be read from, as plain text. */
function ToolResultFallback({ block }: { readonly block: unknown }): React.JSX.Element | null {
  // Nothing while the call runs: the host draws its own pending card, and a
  // second empty one under it says less than nothing.
  if (settledResult(block) === undefined) return null
  return <pre className="cf-toolview__raw">{resultText(block)}</pre>
}

/** Projection `cloudflare_d1_query` publishes for its view. */
function isD1Meta(value: unknown): value is { sql: string; resultSets: readonly D1ResultSet[] } {
  return isRecord(value) && typeof value['sql'] === 'string' && Array.isArray(value['resultSets'])
}

/** Projection `cloudflare_browser_render` publishes for its view. */
function isRenderMeta(value: unknown): value is { url: string; body: string } {
  return isRecord(value) && typeof value['url'] === 'string' && typeof value['body'] === 'string'
}

/** Projection `cloudflare_browser_accessibility_tree` publishes for its view. */
function isTreeMeta(value: unknown): value is { url: string; tree: AxNode } {
  return isRecord(value) && typeof value['url'] === 'string' && isRecord(value['tree'])
}

/** Projection `cloudflare_aigateway_session_cost` publishes for its view. */
function isUsageMeta(value: unknown): value is SessionUsage {
  return (
    isRecord(value) &&
    typeof value['requests'] === 'number' &&
    typeof value['cost'] === 'number' &&
    typeof value['tokensIn'] === 'number' &&
    typeof value['tokensOut'] === 'number' &&
    typeof value['cached'] === 'number'
  )
}

/** `cloudflare_d1_query` as a table, from the block the host supplies. */
export function D1ResultToolView({ block }: ToolCallOwnerProps): React.JSX.Element | null {
  const meta = presentationMetaOf(block)
  if (!isD1Meta(meta)) return <ToolResultFallback block={block} />
  return <D1Result sql={meta.sql} resultSets={meta.resultSets} />
}

/** `cloudflare_browser_render` as captioned text, from the block the host supplies. */
export function BrowserRenderToolView({ block }: ToolCallOwnerProps): React.JSX.Element | null {
  const meta = presentationMetaOf(block)
  if (!isRenderMeta(meta)) return <ToolResultFallback block={block} />
  return <BrowserRender url={meta.url} body={meta.body} />
}

/** `cloudflare_browser_accessibility_tree` as nested lists, from the host's block. */
export function AccessibilityTreeToolView({ block }: ToolCallOwnerProps): React.JSX.Element | null {
  const meta = presentationMetaOf(block)
  if (!isTreeMeta(meta)) return <ToolResultFallback block={block} />
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
