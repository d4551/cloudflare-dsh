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
 */
import type { Context } from '@deepseek-ai/cordis'
import { SessionCostChip } from './SessionCostChip.tsx'
import { SettingsCard } from './SettingsCard.tsx'
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

/** One slot registration request. Every registration this package makes is keyed. */
export interface SlotRegistration {
  readonly name: string
  readonly id: string
  readonly order?: number
}

/** The slice of `ctx.slots` this package uses. */
export interface SlotsRuntime {
  register(registration: SlotRegistration, component: unknown): () => void
  inject(name: string, declare: () => void): void
}

interface SlotsContext extends Context {
  slots: SlotsRuntime
}

/** Slot the session usage chip contributes into. */
export const SESSION_HEADER_SLOT = 'conversation.session.header.actions'
/** Keyed slot the harness uses for per-tool result cards. */
export const TOOL_VIEW_SLOT = 'tool.call.toolview'

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
  // Every contribution is an effect on this plugin's fiber, so unloading the
  // plugin removes it. Registrations made inside an `inject` callback happen
  // whenever the host declares that slot; the effect is created at that moment,
  // which the fiber accepts for as long as the plugin is loaded.
  const register = (registration: SlotRegistration, component: unknown): void => {
    ctx.effect(
      () => slots.register(registration, component),
      `slots.register(${registration.name}#${registration.id})`,
    )
  }

  slots.inject(SESSION_HEADER_SLOT, () => {
    register({ name: SESSION_HEADER_SLOT, id: 'cloudflare-cost', order: 100 }, SessionCostChip)
  })

  slots.inject(TOOL_VIEW_SLOT, () => {
    for (const view of TOOL_VIEWS) {
      register({ name: TOOL_VIEW_SLOT, id: view.tool }, view.component)
    }
  })

  register({ name: 'settings.plugin.cloudflare', id: 'cloudflare-settings' }, SettingsCard)
}
