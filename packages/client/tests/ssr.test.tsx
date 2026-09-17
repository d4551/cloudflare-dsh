// @vitest-environment jsdom
/**
 * What a server render of this client produces.
 *
 * Every other lane renders through a browser: the accessibility scan loads
 * markup into Chromium, the interaction lane mounts React, and the layout lane
 * measures boxes. Server rendering was exercised only in passing, as the way
 * `surfaces.tsx` builds its fixtures, and nothing held it to a contract — so a
 * component could reach for `window` while rendering, emit `undefined` as text,
 * or mint ids that differ between two renders, and every lane would stay green
 * because every lane rendered it somewhere else.
 *
 * This lane states that contract and holds it. Each surface is rendered twice
 * by `react-dom/server` and the two results are compared byte for byte; the ids
 * each render declares are proved unique, resolvable and stable; and the whole
 * client is rendered with the browser globals lifted away — measured by a probe
 * rather than assumed, because a component that read one would otherwise pass
 * here and break in the host that renders it.
 *
 * Hydration is proved with `renderToString` rather than `renderToStaticMarkup`,
 * because React documents only the first as hydratable: the static form omits
 * the text separators hydration matches on. The bytes compared for determinism
 * are the ones the static form produces; the bytes hydrated are the ones a
 * server actually serves.
 */
import { Fragment, type JSX } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { CARD_TOKEN_STORED, CHIP_WITH_USAGE, HOST_COMPOSITION, SURFACES } from './fixtures.tsx'

afterEach(cleanup)

/**
 * Text no render may emit, and an attribute no render may leave empty.
 *
 * These are the shapes a template literal, an arithmetic expression and a
 * stringified object leave behind when the value behind them was never set —
 * the residue a reader sees, which a React warning describes and does not fix.
 */
const ARTEFACTS: readonly string[] = [
  'undefined',
  'NaN',
  '[object Object]',
  'id=""',
  'class=""',
  'for=""',
  'aria-labelledby=""',
  'aria-describedby=""',
  'aria-controls=""',
]

/** The ids one markup string declares, and the ids its attributes point at. */
interface Ids {
  readonly declared: readonly string[]
  readonly referenced: readonly string[]
}

/** Read every id a markup string declares, and every id it refers to. */
function idsIn(markup: string): Ids {
  const declared = [...markup.matchAll(/\sid="([^"]*)"/gu)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
  const references = /\s(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]*)"/gu
  const referenced = [...markup.matchAll(references)].flatMap((match) =>
    (match[1] ?? '').split(/\s+/u).filter((id) => id !== ''),
  )
  return { declared, referenced }
}

/** How many times a marker appears in a markup string. */
const occurrences = (markup: string, marker: string): number => markup.split(marker).length - 1

/**
 * Everything a render's markup must satisfy, read the same way wherever it came from.
 *
 * Applied to the bytes of a server render and to the bytes a hydrated control
 * leaves in the document, because a reader meets both and neither may carry a
 * value that was never set, an id declared twice, or a reference to an id the
 * same page never declares.
 */
function expectCleanMarkup(markup: string, what: string): void {
  expect(markup.length, `${what} rendered nothing`).toBeGreaterThan(0)
  const carried = ARTEFACTS.filter((artefact) => markup.includes(artefact))
  expect(carried, `${what} rendered a value that was never set`).toEqual([])
  const { declared, referenced } = idsIn(markup)
  expect(new Set(declared).size, `${what} declares an id twice`).toBe(declared.length)
  expect(
    referenced.filter((id) => !declared.includes(id)),
    `${what} points at an unknown id`,
  ).toEqual([])
}

/** The browser globals a component must not need in order to render. */
const GLOBALS = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator'] as const

/** One global, held aside while a render runs without it. */
interface HeldGlobal {
  readonly name: string
  readonly descriptor: PropertyDescriptor | undefined
}

/** Take the browser globals away for the duration of a render, returning what they were. */
function liftGlobals(): readonly HeldGlobal[] {
  return GLOBALS.map((name) => ({ name, descriptor: Object.getOwnPropertyDescriptor(globalThis, name) }))
}

/** Put them back exactly as they were. */
function lowerGlobals(held: readonly HeldGlobal[]): void {
  for (const entry of held) {
    if (entry.descriptor !== undefined) Object.defineProperty(globalThis, entry.name, entry.descriptor)
  }
}

/**
 * Which of the browser globals a render could see.
 *
 * Held in a module binding rather than read off the markup, because the
 * question is what the render could reach and not what it printed. A probe that
 * reports nothing is the evidence that the render around it ran without them; a
 * comment saying so would be a claim about code nobody ran.
 */
let visible: readonly string[] = []

/** Record what a render could reach, so the lift above is measured rather than trusted. */
function Probe(): JSX.Element {
  visible = GLOBALS.filter((name) => Reflect.has(globalThis, name))
  return <span>{String(visible.length)}</span>
}

/** Render the whole client with every browser global lifted away. */
function renderWithoutGlobals(): string {
  const held = liftGlobals()
  onTestFinished(() => {
    lowerGlobals(held)
  })
  for (const entry of held) Reflect.deleteProperty(globalThis, entry.name)
  visible = []
  const markup = renderToStaticMarkup(
    <>
      {SURFACES.map((surface) => (
        <Fragment key={surface.name}>{surface.element}</Fragment>
      ))}
      <Probe />
    </>,
  )
  lowerGlobals(held)
  return markup
}

/** A surface served and hydrated: the element React took over, and the document it agreed with. */
interface Served {
  /** The rendered element, after React has taken it over. */
  readonly container: HTMLElement
  /** What the parser made of the server's bytes before React was handed them. */
  readonly parsed: string
}

/**
 * Serve a surface and hydrate it, handing back the container and the parsed bytes.
 *
 * The container is given the server's own bytes first — through a document
 * range rather than an HTML sink, so the markup travels as text and nothing
 * here can be read as executable — which is what makes this hydration rather
 * than a fresh mount: React is handed the markup it must agree with, and
 * reports through `onRecoverableError` when it does not.
 *
 * The comparison is against the *parsed* document, not the server string. A
 * parser normalizes what it reads — void elements lose their self closing
 * slash, and `autoComplete` reaches the DOM as `autocomplete` — so comparing a
 * serialization against the bytes it was parsed from reports those differences
 * on every render and buries the one thing worth seeing: whether React moved a
 * single node.
 */
function hydrateServerRender(element: JSX.Element, recovered: string[]): Served {
  const container = document.createElement('div')
  document.body.append(container)
  const range = document.createRange()
  range.selectNodeContents(container)
  container.append(range.createContextualFragment(renderToString(element)))
  const parsed = container.innerHTML
  render(element, {
    container,
    hydrate: true,
    onRecoverableError: (error) => {
      recovered.push(String(error))
    },
  })
  return { container, parsed }
}

describe('every surface a server renders', () => {
  for (const surface of SURFACES) {
    it(`renders ${surface.name} to clean, repeatable markup`, () => {
      const first = renderToStaticMarkup(surface.element)
      expectCleanMarkup(first, surface.name)
      const second = renderToStaticMarkup(surface.element)
      // Byte for byte: a render that disagreed with itself would put a
      // different document in front of every reader of the same session, and
      // the ids a hydration pass matches on would agree only by luck.
      expect(second, `${surface.name} rendered differently the second time`).toBe(first)
      expect(idsIn(second).declared, `${surface.name} minted different ids the second time`).toEqual(
        idsIn(first).declared,
      )
    })
  }

  it('renders every surface with no browser global in reach', () => {
    const markup = renderWithoutGlobals()
    expect(visible, 'a render still had a browser global in reach').toEqual([])
    // The probe is read twice: from the render itself, and from the bytes it
    // left, so a probe that never ran cannot report an empty list.
    expect(markup).toContain('<span>0</span>')
    expectCleanMarkup(markup, 'the whole client')
  })

  it('names a distinct entry for every state it carries', () => {
    expect(new Set(SURFACES.map((surface) => surface.name)).size).toBe(SURFACES.length)
    expect(SURFACES.length).toBeGreaterThan(19)
  })
})

describe('the client as a host assembles it', () => {
  const assembled = renderToStaticMarkup(HOST_COMPOSITION)

  it('renders once, cleanly, with no id declared twice across the whole page', () => {
    // The headline claim of the test name is asserted through the same
    // primitive the helper reads, so the page's id uniqueness is seen here
    // directly and not only through a helper that also checks it.
    const { declared } = idsIn(assembled)
    expect(new Set(declared).size, 'the assembled client declares an id twice').toBe(declared.length)
    expectCleanMarkup(assembled, 'the assembled client')
  })

  it('renders the same bytes on a second render', () => {
    expect(renderToStaticMarkup(HOST_COMPOSITION)).toBe(assembled)
  })

  it('carries every part of the composition, once or twice as the host composes it', () => {
    // Counted from the page rather than described: a part the composition
    // dropped renders nothing, and every other check here holds for a page
    // that lost half of it.
    expect(occurrences(assembled, 'class="cf-chip"')).toBe(1)
    expect(occurrences(assembled, 'class="cf-settings"')).toBe(1)
    expect(occurrences(assembled, 'class="cf-d1"')).toBe(2)
    expect(occurrences(assembled, 'class="cf-render"')).toBe(2)
    expect(occurrences(assembled, 'class="cf-axtree"')).toBe(2)
    expect(occurrences(assembled, 'class="cf-toolview"')).toBe(2)
  })
})

describe('server markup and the client agree', () => {
  for (const surface of SURFACES) {
    it(`hydrates ${surface.name} without moving a node or reporting a mismatch`, () => {
      const recovered: string[] = []
      const { container, parsed } = hydrateServerRender(surface.element, recovered)
      expect(recovered, `${surface.name} hydrated differently from its server render`).toEqual([])
      expect(container.innerHTML, `${surface.name} moved a node while hydrating`).toBe(parsed)
    })
  }

  it('reaches the chip detail, which is the state no prop can put it in', () => {
    const served = renderToString(CHIP_WITH_USAGE)
    const { container, parsed } = hydrateServerRender(CHIP_WITH_USAGE, [])
    expect(container.innerHTML).toBe(parsed)
    const toggle = container.querySelector('button')
    if (toggle !== null) fireEvent.click(toggle)
    // The server sends the collapsed state; the control reaches the other one.
    expect(served).toContain('Show detail')
    expect(container.innerHTML).toContain('Hide detail')
    expectCleanMarkup(container.innerHTML, 'the expanded chip')
  })

  it('reaches the card error state, which is the other state no prop can put it in', () => {
    const served = renderToString(CARD_TOKEN_STORED)
    const { container } = hydrateServerRender(CARD_TOKEN_STORED, [])
    const field = container.querySelector('input[name="apiTokenRef"]')
    if (field !== null) fireEvent.change(field, { target: { value: 'not a reference' } })
    const submit = container.querySelector('button[type="submit"]')
    if (submit !== null) fireEvent.click(submit)
    expect(served).not.toContain('uppercase letters')
    expect(container.innerHTML).toContain(
      'A token reference must be an environment variable name: uppercase letters, digits and underscores.',
    )
    expectCleanMarkup(container.innerHTML, 'the card showing a validation error')
  })
})
