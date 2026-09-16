/**
 * The measurements the browser lanes take from a laid-out page.
 *
 * One definition of each, because two lanes ask the same questions: the
 * viewport lane holds every control to the floor its pointer earns, and the
 * layout lane holds each surface's rows, grids and scrollers to their shape.
 * Two copies of the measuring would let one lane's numbers drift from the
 * other's while both read as green — and these are the numbers no declared
 * value can stand in for, since a class name proves nothing about a box.
 */
import type { Page } from 'playwright'

/** One control as it was laid out, and whether either axis is under the floor. */
export interface ControlBox {
  readonly what: string
  readonly width: number
  readonly height: number
  readonly under: boolean
}

/** Every focus stop on the page, measured against `floor` CSS pixels. */
export function controls(page: Page, floor: number): Promise<readonly ControlBox[]> {
  return page.evaluate(
    (limit) =>
      [...document.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')].map((node) => {
        const box = node.getBoundingClientRect()
        const named = node.getAttribute('name')
        return {
          what: `${node.tagName.toLowerCase()}${named === null ? '' : `[${named}]`}`,
          width: Math.round(box.width),
          height: Math.round(box.height),
          under: box.width < limit || box.height < limit,
        }
      }),
    floor,
  )
}

/** One laid-out box, in whole CSS pixels. */
export interface Box {
  readonly what: string
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/**
 * The box of every child of `parent` that draws something.
 *
 * A child with no area is left out rather than reported as a zero box: a
 * collapsed detail is not a row that failed to line up with its siblings.
 */
export function boxesOf(page: Page, parent: string): Promise<readonly Box[]> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)
    if (root === null) return []
    return [...root.children].flatMap((node) => {
      const rect = node.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return []
      return [
        {
          what: `${node.tagName.toLowerCase()}.${node.className}`,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      ]
    })
  }, parent)
}

/**
 * Every pair of children of `grid` whose boxes intersect.
 *
 * A one-pixel tolerance, because neighbouring grid cells share an edge and a
 * sub-pixel rounding of that edge is not one cell sitting on another.
 */
export function overlappingCells(page: Page, grid: string): Promise<readonly string[]> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector)
    if (root === null) return [`nothing matched ${selector}`]
    const cells = [...root.children].map((node) => ({
      what: `${node.tagName.toLowerCase()}:${(node.textContent ?? '').trim()}`,
      box: node.getBoundingClientRect(),
    }))
    const overlaps: string[] = []
    for (const [index, first] of cells.entries()) {
      for (const second of cells.slice(index + 1)) {
        const apart =
          first.box.left >= second.box.right - 1 ||
          second.box.left >= first.box.right - 1 ||
          first.box.top >= second.box.bottom - 1 ||
          second.box.top >= first.box.bottom - 1
        if (!apart) overlaps.push(`${first.what} over ${second.what}`)
      }
    }
    return overlaps
  }, grid)
}

/** One list item: how deep it sits, and how far its box is held in from the card's edge. */
export interface Indent {
  readonly what: string
  readonly depth: number
  readonly inset: number
}

/** Every list item under `selector`, with the nesting depth it was laid out at. */
export function indentation(page: Page, selector: string): Promise<readonly Indent[]> {
  return page.evaluate((root) => {
    const card = document.querySelector(root)
    if (card === null) return []
    const origin = card.getBoundingClientRect().left
    return [...card.querySelectorAll<HTMLElement>('li')].map((node) => {
      let depth = 0
      for (let at = node.parentElement; at !== null && at !== card; at = at.parentElement) {
        if (at.tagName === 'UL' || at.tagName === 'OL') depth += 1
      }
      return {
        what: (node.textContent ?? '').trim(),
        depth,
        inset: Math.round(node.getBoundingClientRect().left - origin),
      }
    })
  }, selector)
}

/** One element that runs past the viewport with no scroller a keyboard can reach around it. */
export interface Past {
  readonly what: string
  readonly right: number
}

/**
 * Elements past `width` that no keyboard-reachable scroller contains.
 *
 * Reaching the overflow is the point: a wide table is allowed to scroll, but a
 * scroller nobody can focus holds its content out of reach of the keyboard
 * (SC 2.1.1), which is worse than the overflow it was added to fix.
 */
export function pastViewport(page: Page, width: number): Promise<readonly Past[]> {
  return page.evaluate((limit) => {
    const reachable = (node: Element): boolean => {
      const tabindex = node.getAttribute('tabindex')
      return tabindex !== null && Number.parseInt(tabindex, 10) >= 0
    }
    const scrollers = new Set<Element>()
    for (const node of document.querySelectorAll('main *')) {
      if (/^(?:auto|scroll)$/u.test(getComputedStyle(node).overflowX) && reachable(node)) scrollers.add(node)
    }
    const offenders: Past[] = []
    for (const node of document.querySelectorAll<HTMLElement>('main *')) {
      let surrounded = false
      // A proper ancestor, not the node itself: a scroller that does not fit
      // the viewport is an offender like any other.
      for (let at = node.parentElement; at !== null; at = at.parentElement) {
        if (scrollers.has(at)) {
          surrounded = true
          break
        }
      }
      if (surrounded) continue
      const box = node.getBoundingClientRect()
      if (box.right > limit + 1) {
        offenders.push({ what: `${node.tagName.toLowerCase()}.${node.className}`, right: Math.round(box.right) })
      }
    }
    return offenders
  }, width)
}
