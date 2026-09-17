/**
 * The measurement the browser lanes take from a laid-out page.
 *
 * One definition, because the number is the one thing no declared value can
 * stand in for: a class name proves nothing about a box, so the target-size
 * criterion is held to what the control was actually laid out at.
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
