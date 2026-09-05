import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as client from '../src/index.ts'

/** A context with a recording slots runtime, as the Web Client would supply. */
function harness() {
  const registered: { name: string; id?: string; order?: number; component: unknown }[] = []
  const declared: string[] = []
  const ctx = new Context()
  ctx.provide('slots', {
    register(registration: client.SlotRegistration, component: unknown) {
      registered.push({ ...registration, component })
      return () => registered.pop()
    },
    inject(name: string, declare: () => void) {
      declared.push(name)
      declare()
    },
  })
  client.apply(ctx)
  return { registered, declared }
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
    const { declared } = harness()
    expect(declared).toEqual([client.SESSION_HEADER_SLOT, client.TOOL_VIEW_SLOT])
  })

  it('registers the session cost chip in the conversation header', () => {
    const { registered } = harness()
    const chip = registered.find((r) => r.id === 'cloudflare-cost')
    expect(chip?.name).toBe(client.SESSION_HEADER_SLOT)
    expect(chip?.component).toBe(client.SessionCostChip)
  })

  it('orders the chip after the host’s own header actions', () => {
    const { registered } = harness()
    expect(registered.find((r) => r.id === 'cloudflare-cost')?.order).toBe(100)
  })

  it('registers the settings card in its own settings slot', () => {
    const { registered } = harness()
    const card = registered.find((r) => r.id === 'cloudflare-settings')
    expect(card?.name).toBe('settings.plugin.cloudflare')
    expect(card?.component).toBe(client.SettingsCard)
  })

  it.each([
    ['cloudflare_d1_query', 'D1Result'],
    ['cloudflare_browser_render', 'BrowserRender'],
    ['cloudflare_browser_accessibility_tree', 'AccessibilityTree'],
  ])('keys a tool view for %s', (tool) => {
    const { registered } = harness()
    const view = registered.find((r) => r.name === client.TOOL_VIEW_SLOT && r.id === tool)
    expect(view).toBeDefined()
  })

  it('keys every tool view by its wire tool name', () => {
    const { registered } = harness()
    const views = registered.filter((r) => r.name === client.TOOL_VIEW_SLOT)
    expect(views.map((v) => v.id)).toEqual(client.TOOL_VIEWS.map((v) => v.tool))
  })

  it('registers exactly the surfaces it declares', () => {
    const { registered } = harness()
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
