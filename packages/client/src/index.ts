/**
 * `@d4551/dsh-cloudflare-client` — Web Client surfaces for the Cloudflare bundle.
 *
 * Contributes three things to the harness's Web Client: a settings card, a
 * per-session gateway usage chip in the conversation header, and tool views for
 * the tools whose output is worth more than a JSON blob.
 *
 * The slots runtime is consumed structurally rather than by importing the
 * client UI package, so this package builds and tests without the whole client
 * stack present. Components never receive `ctx`, per the harness's rule.
 *
 * Structural, but not invented: the shapes below are read from the published
 * declarations of `@deepseek-ai/dsh-client-runtime`'s `SlotRegistry` and
 * `@deepseek-ai/dsh-client-ui-slots@0.1.2-rc.1`'s `SlotCore`, and the slot
 * contracts from `-ui-conversation`, `-ui-tool` and `-ui-settings` at the same
 * version. Importing them is not possible here: their published declarations
 * reference type-only packages they do not depend on, and one of them does not
 * typecheck against its own `SlotMap`, so with `skipLibCheck` off the compiler
 * stops before it reaches this file. What the compiler cannot check, the
 * contract suite pins instead.
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionCostChip } from './SessionCostChip.tsx'
import { SettingsCard } from './SettingsCard.tsx'
import { en } from './locales/en.ts'
import { AccessibilityTree } from './toolviews/AccessibilityTree.tsx'
import { BrowserRender } from './toolviews/BrowserRender.tsx'
import { D1Result } from './toolviews/D1Result.tsx'

export * from './format.ts'
export * from './locales/en.ts'
export { SessionCostChip, type SessionCostChipProps } from './SessionCostChip.tsx'
export { SettingsCard, type CloudflareSettings, type SettingsCardProps } from './SettingsCard.tsx'
export {
  AccessibilityTree,
  type AccessibilityTreeProps,
  type AxNode,
} from './toolviews/AccessibilityTree.tsx'
export { BrowserRender, type BrowserRenderProps } from './toolviews/BrowserRender.tsx'
export { D1Result, type D1ResultProps, type D1ResultSet } from './toolviews/D1Result.tsx'

/** The slot a registration contributes into. Every registration names one. */
interface SlotTarget {
  readonly name: string
}

/**
 * A list slot's registration: `id` is the cell, `order` places it among its
 * siblings, `label` names it where the host renders a label. The registry
 * throws on a list registration with no `id`.
 */
export interface ListSlotRegistration extends SlotTarget {
  readonly id: string
  readonly order?: number
  readonly label?: string
}

/**
 * A keyed slot's registration: `key` is the value the host dispatches on — for
 * a tool view, the wire tool name. The registry throws on a keyed registration
 * with no `key`, which is why this is not an `id`.
 */
export interface KeyedSlotRegistration extends SlotTarget {
  readonly key: string
}

/** One registration this package makes. */
export type SlotRegistration = ListSlotRegistration | KeyedSlotRegistration

/**
 * What an injected effect installs for one declaration lifetime: a disposer,
 * or several to be installed together and disposed in reverse.
 */
export type SlotEffect = (() => void) | Iterable<() => void>

/** The slice of `ctx.slots` this package uses. */
export interface SlotsRuntime {
  /**
   * Contribute a component to a declared slot. The registry installs the
   * disposer on the calling fiber itself, so unloading this plugin removes the
   * contribution — wrapping the call in another `ctx.effect` would leave one
   * disposal under two owners.
   */
  register(registration: SlotRegistration, component: unknown): () => void
  /**
   * Run an effect for each declaration lifetime of a slot: synchronously when
   * the slot is already declared, otherwise when whoever owns it declares it.
   * The effect's disposers are what a collapsed declaration removes, so they
   * are returned rather than dropped.
   */
  inject(name: string, effect: () => SlotEffect): () => void
}

interface SlotsContext extends Context {
  slots: SlotsRuntime
}

/** List slot for session-scoped actions beside the conversation title. */
export const SESSION_HEADER_SLOT = 'conversation.session.header.actions'
/** Keyed slot the harness dispatches per-tool result cards through. */
export const TOOL_VIEW_SLOT = 'tool.call.toolview'
/**
 * List slot holding one page per plugin inside the Plugins settings section.
 * There is no per-plugin settings slot: a plugin's page is a tab in this one,
 * and registering into a slot nobody declared throws.
 */
export const SETTINGS_SLOT = 'settings.plugins.tab'

/** Tool views this package supplies, keyed by wire tool name. */
export const TOOL_VIEWS: ReadonlyArray<{ readonly tool: string; readonly component: unknown }> = [
  { tool: 'cloudflare_d1_query', component: D1Result },
  { tool: 'cloudflare_browser_render', component: BrowserRender },
  { tool: 'cloudflare_browser_accessibility_tree', component: AccessibilityTree },
]

export const name = 'cloudflare-client'
export const inject = ['slots']

export function apply(ctx: Context): void {
  const slots = (ctx as SlotsContext).slots

  slots.inject(SESSION_HEADER_SLOT, () =>
    slots.register({ name: SESSION_HEADER_SLOT, id: 'cloudflare-cost', order: 100 }, SessionCostChip),
  )

  slots.inject(TOOL_VIEW_SLOT, () =>
    TOOL_VIEWS.map((view) => slots.register({ name: TOOL_VIEW_SLOT, key: view.tool }, view.component)),
  )

  slots.inject(SETTINGS_SLOT, () =>
    slots.register(
      { name: SETTINGS_SLOT, id: 'cloudflare', order: 100, label: en.settings.heading },
      SettingsCard,
    ),
  )
}
