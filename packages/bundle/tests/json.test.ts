import { describe, expect, it } from 'vitest'
import { isFiniteNumber, isObject } from '../src/tools/_shared/json.ts'

describe('isObject', () => {
  it.each([
    ['an object', {}],
    ['an array', []],
  ])('accepts %s', (_label, value) => {
    expect(isObject(value)).toBe(true)
  })

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a number', 1],
    ['a boolean', true],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(isObject(value)).toBe(false)
  })
})

describe('isFiniteNumber', () => {
  it.each([
    ['zero', 0],
    ['a negative decimal', -1.5],
  ])('accepts %s', (_label, value) => {
    expect(isFiniteNumber(value)).toBe(true)
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '1'],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(isFiniteNumber(value)).toBe(false)
  })
})
