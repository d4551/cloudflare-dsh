import { describe, expect, it } from 'vitest'
import { isFiniteNumber, isInteger, isObject, isStringArray } from '../src/tools/_shared/json.ts'

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

describe('isInteger', () => {
  it.each([
    ['zero', 0],
    ['a negative integer', -3],
    ['a large integer', 10_000],
  ])('accepts %s', (_label, value) => {
    expect(isInteger(value)).toBe(true)
  })

  it.each([
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a numeric string', '1'],
    ['null', null],
  ])('refuses %s', (_label, value) => {
    expect(isInteger(value)).toBe(false)
  })
})

describe('isStringArray', () => {
  it.each([
    ['an empty array', []],
    ['an array of strings', ['a', 'b']],
  ])('accepts %s', (_label, value) => {
    expect(isStringArray(value)).toBe(true)
  })

  it.each([
    ['a string', 'a'],
    ['an array holding a number', ['a', 1]],
    ['null', null],
    ['an object', {}],
  ])('refuses %s', (_label, value) => {
    expect(isStringArray(value)).toBe(false)
  })
})
