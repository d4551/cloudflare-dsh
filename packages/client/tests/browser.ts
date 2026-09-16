/**
 * The Chromium every browser lane drives.
 *
 * Each lane opened its own browser with the same four lines — a binding, a
 * `beforeAll` that launches, an `afterAll` that closes — and the copies had
 * already drifted: two lanes registered nothing for cleanup, so a lane that
 * failed mid-test could leave a browser running. One declaration, one lifetime.
 *
 * Playwright resolves the browser itself, honouring the environment's own
 * browser-path configuration, so no lane pins an executable path.
 */
import { type Browser, chromium } from 'playwright'
import { afterAll, beforeAll } from 'vitest'

/** The browser a lane drives, open for as long as the lane runs. */
export interface Lane {
  readonly browser: Browser
}

/**
 * Open a browser for the calling lane, and close it when the lane ends.
 *
 * Called at the top level of a lane module, which is where vitest's own hooks
 * have to be registered. The browser is handed out through a getter that
 * refuses before it is open, so a lane that reached it too early fails by name
 * rather than driving an undefined handle.
 */
export function browserLane(): Lane {
  let opened: Browser | undefined
  beforeAll(async () => {
    opened = await launch()
  }, 60_000)
  afterAll(async () => {
    await opened?.close()
  })
  return {
    get browser(): Browser {
      if (opened === undefined) throw new Error('the lane asked for its browser before it opened')
      return opened
    },
  }
}

/**
 * Launch the browser both lanes drive.
 *
 * Playwright resolves the browser itself, honouring the environment's own
 * browser-path configuration; a lane that pinned an executable path would
 * bypass that resolution and drift from what CI drives.
 */
export function launch(): Promise<Browser> {
  return chromium.launch()
}
