import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as client from '../src/index.ts'
import { AccessibilityTree } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'

/** One recorded contribution, flattened so a test can read either kind's fields. */
interface Entry {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly label?: string
  readonly component: unknown
}

/**
 * A slots runtime that behaves as the published `SlotRegistry` documents.
 *
 * `register` hands back the disposer for its contribution; `inject` runs the
 * effect for the declaration's lifetime and keeps what it returned, disposing
 * an iterable in reverse. Modelling that here is what lets a test observe the
 * obligation this package actually has — returning its disposers — rather than
 * the registry's own bookkeeping.
 */
function harness() {
  const registered: Entry[] = []
  const injected: string[] = []
  const releases: (() => void)[] = []
  const ctx = new Context()
  ctx.provide('slots', {
    register(registration: client.SlotRegistration, component: unknown) {
      const entry: Entry = { ...registration, component }
      registered.push(entry)
      return () => {
        registered.splice(registered.indexOf(entry), 1)
      }
    },
    inject(name: string, effect: () => client.SlotEffect) {
      injected.push(name)
      const installed = effect()
      const disposers = typeof installed === 'function' ? [installed] : [...installed]
      const release = () => {
        for (const dispose of disposers.toReversed()) dispose()
      }
      releases.push(release)
      return release
    },
  })
  return { ctx, registered, injected, releases, apply: () => client.apply(ctx) }
}

const entryFor = (registered: readonly Entry[], slot: string, cell: string): Entry | undefined =>
  registered.find((entry) => entry.name === slot && (entry.id ?? entry.key) === cell)

describe('plugin shape', () => {
  it('declares its name and injections', () => {
    expect(client.name).toBe('cloudflare-client')
    expect(client.inject).toEqual(['slots'])
  })

  it('names the slots it contributes into', () => {
    expect(client.SESSION_HEADER_SLOT).toBe('conversation.session.header.actions')
    expect(client.TOOL_VIEW_SLOT).toBe('tool.call.toolview')
    expect(client.SETTINGS_SLOT).toBe('settings.plugins.tab')
  })
})

describe('registration', () => {
  it('waits for each slot to be declared before contributing into it', () => {
    // Registering into a slot nobody has declared throws, and none of these
    // three is declared by the framework itself.
    const { injected, apply } = harness()
    apply()
    expect(injected).toEqual([client.SESSION_HEADER_SLOT, client.TOOL_VIEW_SLOT, client.SETTINGS_SLOT])
  })

  it('registers the session cost chip as an ordered header action', () => {
    const { registered, apply } = harness()
    apply()
    expect(entryFor(registered, client.SESSION_HEADER_SLOT, 'cloudflare-cost')).toEqual({
      name: client.SESSION_HEADER_SLOT,
      id: 'cloudflare-cost',
      order: 100,
      component: client.SessionCostChip,
    })
  })

  it('registers the settings card as a page in the Plugins section', () => {
    const { registered, apply } = harness()
    apply()
    expect(entryFor(registered, client.SETTINGS_SLOT, 'cloudflare')).toEqual({
      name: client.SETTINGS_SLOT,
      id: 'cloudflare',
      order: 100,
      label: 'Cloudflare',
      component: client.SettingsCard,
    })
  })

  it.each([
    ['cloudflare_d1_query', D1Result],
    ['cloudflare_browser_render', BrowserRender],
    ['cloudflare_browser_accessibility_tree', AccessibilityTree],
  ])('keys the tool view for %s to its component', (tool, component) => {
    const { registered, apply } = harness()
    apply()
    expect(entryFor(registered, client.TOOL_VIEW_SLOT, tool)).toEqual({
      name: client.TOOL_VIEW_SLOT,
      key: tool,
      component,
    })
  })

  it('dispatches every tool view by key, since a keyed slot has no id', () => {
    // A tool view registered with `id` is what the registry throws on, so the
    // absence of one is the assertion, not an implementation detail.
    const { registered, apply } = harness()
    apply()
    const views = registered.filter((entry) => entry.name === client.TOOL_VIEW_SLOT)
    expect(views.map((view) => view.key)).toEqual(client.TOOL_VIEWS.map((view) => view.tool))
    expect(views.filter((view) => 'id' in view)).toEqual([])
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
  it('returns each contribution’s disposer, so a collapsed declaration takes it away', () => {
    const { registered, releases, apply } = harness()
    apply()
    for (const release of releases) release()
    expect(registered).toEqual([])
  })

  it('takes away only the contributions of the declaration that collapsed', () => {
    const { registered, releases, apply } = harness()
    apply()
    releases[1]?.()
    expect(registered.map((entry) => entry.name)).toEqual([client.SESSION_HEADER_SLOT, client.SETTINGS_SLOT])
  })

  it('installs no effect of its own, because the registry owns disposal', async () => {
    // `slots.register` and `slots.inject` each install their disposer on the
    // calling fiber. An `ctx.effect` around either would put one disposal under
    // two owners, which is what this asserts is not happening.
    const { ctx } = harness()
    const fiber = await ctx.plugin(client)
    expect(fiber.getEffects()).toEqual([])
  })
})
