import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as client from '../src/index.ts'
import { AccessibilityTree } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'

/** A context with a recording slots runtime, as the Web Client would supply. */
function harness() {
  const registered: { name: string; id: string; order?: number; component: unknown }[] = []
  const declared: string[] = []
  const ctx = new Context()
  ctx.provide('slots', {
    register(registration: client.SlotRegistration, component: unknown) {
      const entry = { ...registration, component }
      registered.push(entry)
      return () => {
        registered.splice(registered.indexOf(entry), 1)
      }
    },
    inject(name: string, declare: () => void) {
      declared.push(name)
      declare()
    },
  })
  return { ctx, registered, declared, apply: () => client.apply(ctx) }
}

describe('plugin shape', () => {
  it('declares its name and injections', () => {
    expect(client.name).toBe('cloudflare-client')
    expect(client.inject).toEqual(['slots'])
  })

  it('names the slots it contributes into', () => {
    expect(client.SESSION_HEADER_SLOT).toBe('conversation.session.header.actions')
    expect(client.TOOL_VIEW_SLOT).toBe('tool.call.toolview')
  })
})

describe('registration', () => {
  it('injects into both host slots before registering', () => {
    const { declared, apply } = harness()
    apply()
    expect(declared).toEqual([client.SESSION_HEADER_SLOT, client.TOOL_VIEW_SLOT])
  })

  it('registers the session cost chip in the conversation header', () => {
    const { registered, apply } = harness()
    apply()
    const chip = registered.find((r) => r.id === 'cloudflare-cost')
    expect(chip?.name).toBe(client.SESSION_HEADER_SLOT)
    expect(chip?.component).toBe(client.SessionCostChip)
  })

  it('orders the chip after the host’s own header actions', () => {
    const { registered, apply } = harness()
    apply()
    expect(registered.find((r) => r.id === 'cloudflare-cost')?.order).toBe(100)
  })

  it('registers the settings card in its own settings slot', () => {
    const { registered, apply } = harness()
    apply()
    const card = registered.find((r) => r.id === 'cloudflare-settings')
    expect(card?.name).toBe('settings.plugin.cloudflare')
    expect(card?.component).toBe(client.SettingsCard)
  })

  it.each([
    ['cloudflare_d1_query', D1Result],
    ['cloudflare_browser_render', BrowserRender],
    ['cloudflare_browser_accessibility_tree', AccessibilityTree],
  ])('keys the tool view for %s to its component', (tool, component) => {
    const { registered, apply } = harness()
    apply()
    const view = registered.find((r) => r.name === client.TOOL_VIEW_SLOT && r.id === tool)
    expect(view?.component).toBe(component)
  })

  it('keys every tool view by its wire tool name', () => {
    const { registered, apply } = harness()
    apply()
    const views = registered.filter((r) => r.name === client.TOOL_VIEW_SLOT)
    expect(views.map((v) => v.id)).toEqual(client.TOOL_VIEWS.map((v) => v.tool))
  })

  it('registers exactly the surfaces it declares', () => {
    const { registered, apply } = harness()
    apply()
    expect(registered).toHaveLength(client.TOOL_VIEWS.length + 2)
  })

  it('maps each tool view entry to its component', () => {
    expect(client.TOOL_VIEWS.map((v) => v.component)).toEqual([
      client.D1Result,
      client.BrowserRender,
      client.AccessibilityTree,
    ])
  })
})

describe('lifecycle', () => {
  it('releases every registration when the plugin fiber unloads', async () => {
    // Through cordis rather than by calling the disposer directly: this is the
    // path the harness takes when a plugin is removed from a profile.
    const { ctx, registered } = harness()
    const fiber = await ctx.plugin(client)
    expect(registered).toHaveLength(5)
    // The labels are what `getEffects()` shows someone debugging a profile, so
    // they name the slot and the key of each contribution.
    expect(fiber.getEffects().map((effect) => effect.label)).toEqual([
      'slots.register(conversation.session.header.actions#cloudflare-cost)',
      'slots.register(tool.call.toolview#cloudflare_d1_query)',
      'slots.register(tool.call.toolview#cloudflare_browser_render)',
      'slots.register(tool.call.toolview#cloudflare_browser_accessibility_tree)',
      'slots.register(settings.plugin.cloudflare#cloudflare-settings)',
    ])
    await fiber.dispose()
    expect(registered).toEqual([])
    expect(fiber.getEffects()).toEqual([])
  })
})
