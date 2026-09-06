import { describe, expect, it } from 'vitest'
import {
  PAGE_OUTCOME_PROPERTIES,
  PageNumberError,
  ResultInfoShapeError,
  cursorNote,
  cursorOutcome,
  pageNote,
  pageOutcome,
  requestedPage,
  wholeListNote,
  wholeListOutcome,
} from '../src/tools/_shared/paging.ts'

describe('requestedPage', () => {
  it('is the first page when the call did not say', () => {
    expect(requestedPage(undefined)).toBe(1)
  })

  it('is the page the call asked for', () => {
    expect(requestedPage(1)).toBe(1)
    expect(requestedPage(7)).toBe(7)
  })

  it.each([0, -1])('refuses page %i, which is before the first', (page) => {
    expect(() => requestedPage(page)).toThrow(`page must be 1 or more, got ${page}`)
  })

  it('names the refusal', () => {
    expect(new PageNumberError(0)).toMatchObject({ name: 'PageNumberError' })
  })
})

describe('pageOutcome', () => {
  it('is certain when the API reports a total', () => {
    expect(pageOutcome({ total_count: 5 }, 1, 2, 2)).toEqual({
      page: 1,
      perPage: 2,
      total: 5,
      complete: false,
    })
    expect(pageOutcome({ total_count: 5 }, 3, 2, 1)).toEqual({
      page: 3,
      perPage: 2,
      total: 5,
      complete: true,
    })
  })

  it('treats a page that ends exactly on the total as the last', () => {
    expect(pageOutcome({ total_count: 4 }, 2, 2, 2)).toEqual({
      page: 2,
      perPage: 2,
      total: 4,
      complete: true,
    })
  })

  it('is complete for an empty listing', () => {
    expect(pageOutcome({ total_count: 0 }, 1, 50, 0)).toEqual({
      page: 1,
      perPage: 50,
      total: 0,
      complete: true,
    })
  })

  it('infers from a short page when the API reports no total', () => {
    expect(pageOutcome(undefined, 1, 2, 2)).toEqual({ page: 1, perPage: 2, total: null, complete: false })
    expect(pageOutcome({}, 1, 2, 1)).toEqual({ page: 1, perPage: 2, total: null, complete: true })
  })

  it('refuses a total that is not an integer rather than guessing', () => {
    expect(() => pageOutcome({ total_count: 2.5 }, 1, 2, 2)).toThrow(
      'result_info.total_count must be an integer, got number',
    )
  })
})

describe('wholeListOutcome', () => {
  it('is complete when the API reports no total', () => {
    expect(wholeListOutcome(undefined, 3)).toEqual({ total: null, complete: true })
  })

  it('compares what was returned with the total the API reports', () => {
    expect(wholeListOutcome({ total_count: 3 }, 3)).toEqual({ total: 3, complete: true })
    expect(wholeListOutcome({ total_count: 5 }, 3)).toEqual({ total: 5, complete: false })
  })
})

describe('cursorOutcome', () => {
  it('is complete when the API omits the cursor or sends an empty one', () => {
    expect(cursorOutcome(undefined)).toEqual({ cursor: '', complete: true })
    expect(cursorOutcome({})).toEqual({ cursor: '', complete: true })
    expect(cursorOutcome({ cursor: '' })).toEqual({ cursor: '', complete: true })
  })

  it('hands back the cursor for the next page', () => {
    expect(cursorOutcome({ cursor: 'abc' })).toEqual({ cursor: 'abc', complete: false })
  })

  it('refuses a cursor that is not a string', () => {
    expect(() => cursorOutcome({ cursor: 7 })).toThrow('result_info.cursor must be a string, got number')
  })

  it('names the shape refusal', () => {
    expect(new ResultInfoShapeError('cursor', 7)).toMatchObject({ name: 'ResultInfoShapeError' })
  })
})

describe('notes', () => {
  it('says which page of how many when the total is known', () => {
    expect(pageNote({ page: 2, perPage: 2, total: 5, complete: false })).toBe('page 2 of 3')
    expect(pageNote({ page: 1, perPage: 50, total: 0, complete: true })).toBe('page 1 of 1')
  })

  it('says what a short or full page implies when the total is unknown', () => {
    expect(pageNote({ page: 1, perPage: 2, total: null, complete: true })).toBe('page 1, the last')
    expect(pageNote({ page: 1, perPage: 2, total: null, complete: false })).toBe('page 1, more may follow')
  })

  it('notes an unpaged listing only when the API reported more than it returned', () => {
    expect(wholeListNote({ total: null, complete: true })).toBeUndefined()
    expect(wholeListNote({ total: 5, complete: false })).toBe('the API reports 5 in all')
  })

  it('notes a cursor listing only when more follows', () => {
    expect(cursorNote({ cursor: '', complete: true })).toBeUndefined()
    expect(cursorNote({ cursor: 'abc', complete: false })).toBe('more follow the cursor')
  })
})

describe('PAGE_OUTCOME_PROPERTIES', () => {
  it('declares the four fields every page-numbered listing carries, all required', () => {
    expect(Object.keys(PAGE_OUTCOME_PROPERTIES)).toEqual(['page', 'perPage', 'total', 'complete'])
    expect(Object.values(PAGE_OUTCOME_PROPERTIES).every((property) => property.required)).toBe(true)
  })
})
