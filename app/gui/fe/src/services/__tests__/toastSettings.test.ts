import { describe, it, expect, beforeEach } from 'vitest'
import { getToastDurationMs, setToastDurationMs } from '../toastSettings'

describe('toastSettings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('getToastDurationMs returns 5000 when nothing stored', () => {
    expect(getToastDurationMs()).toBe(5000)
  })

  it('setToastDurationMs/getToastDurationMs roundtrip', () => {
    setToastDurationMs(8000)
    expect(getToastDurationMs()).toBe(8000)
  })

  it('setToastDurationMs(0) returns 0 (never dismiss)', () => {
    setToastDurationMs(0)
    expect(getToastDurationMs()).toBe(0)
  })

  it('setToastDurationMs(3000) returns 3000', () => {
    setToastDurationMs(3000)
    expect(getToastDurationMs()).toBe(3000)
  })
})
