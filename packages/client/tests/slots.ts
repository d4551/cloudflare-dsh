/**
 * A slots runtime that behaves as the published `SlotRegistry` documents.
 *
 * `register` hands back the disposer for its contribution; `inject` runs the
 * effect for the declaration's lifetime and keeps what it returned, disposing
 * an iterable in reverse. Modelling that here is what lets a test observe the
 * obligation this package actually has — returning its disposers rather than
 * dropping them — instead of the registry's own bookkeeping.
 *
 * Shared by the registration suite and the coverage statement, which read the
 * same contribution list. Two copies of it would let one suite see a
 * composition the other cannot see, which is the failure a registration check
 * exists to notice.
 */
import { Context } from '@deepseek-ai/cordis'
import { apply as contribute } from '../src/index.ts'
import type { SlotComponent, SlotEffect, SlotRegistration } from '../src/index.ts'

/** One recorded contribution, flattened so a test can read either kind's fields. */
export interface Contribution {
  readonly name: string
  readonly id?: string
  readonly key?: string
  readonly order?: number
  readonly label?: string
  readonly component: SlotComponent
}

/** A slots runtime a test can drive, and what the plugin contributed to it. */
export interface Registry {
  readonly ctx: Context
  /** Every contribution, in the order it was made. */
  readonly registered: Contribution[]
  /** Every slot the plugin waited on, in the order it waited. */
  readonly injected: string[]
  /** One release per declaration, which disposes that declaration's contributions. */
  readonly releases: (() => void)[]
  /** Install the plugin into this runtime. */
  install(): void
}

/** Build a runtime, then let a test install the plugin into it. */
export function registry(): Registry {
  const registered: Contribution[] = []
  const injected: string[] = []
  const releases: (() => void)[] = []
  const ctx = new Context()
  ctx.provide('slots', {
    register(registration: SlotRegistration, component: SlotComponent) {
      const entry: Contribution = { ...registration, component }
      registered.push(entry)
      return () => {
        registered.splice(registered.indexOf(entry), 1)
      }
    },
    inject(name: string, effect: () => SlotEffect) {
      injected.push(name)
      const installed = effect()
      const disposers = typeof installed === 'function' ? [installed] : [...installed]
      const release = (): void => {
        for (const dispose of disposers.toReversed()) dispose()
      }
      releases.push(release)
      return release
    },
  })
  return {
    ctx,
    registered,
    injected,
    releases,
    install: (): void => contribute(ctx),
  }
}
