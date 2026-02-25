import { describe, it, expect } from 'vitest'
import { parseUnlockError } from '../../utils/walletErrors'

describe('parseUnlockError', () => {
  it('maps "Incorrect password" to user-friendly message', () => {
    const result = parseUnlockError('Incorrect password')
    expect(result.title).toBe('Incorrect password')
    expect(result.suggestion).toContain('check your password')
    expect(result.raw).toBe('Incorrect password')
  })

  it('maps wallet file corruption — bad nonce', () => {
    const result = parseUnlockError('Invalid wallet file: bad nonce length')
    expect(result.title).toBe('Wallet file corrupted')
    expect(result.suggestion).toContain('recovery phrase')
    expect(result.raw).toBe('Invalid wallet file: bad nonce length')
  })

  it('maps wallet file corruption — invalid format', () => {
    const result = parseUnlockError('Invalid wallet file format: unexpected token')
    expect(result.title).toBe('Wallet file corrupted')
    expect(result.suggestion).toContain('recovery phrase')
  })

  it('maps wallet file corruption — not valid UTF-8', () => {
    const result = parseUnlockError('Decrypted data is not valid UTF-8')
    expect(result.title).toBe('Wallet file corrupted')
    expect(result.suggestion).toContain('recovery phrase')
  })

  it('maps file read permission errors', () => {
    const result = parseUnlockError('Failed to read wallet file: permission denied')
    expect(result.title).toBe('Cannot read wallet file')
    expect(result.suggestion).toContain('permission')
  })

  it('maps key derivation errors', () => {
    const result = parseUnlockError('Key derivation failed: memory allocation error')
    expect(result.title).toBe('Key derivation failed')
    expect(result.suggestion).toContain('restarting')
  })

  it('handles Error objects', () => {
    const result = parseUnlockError(new Error('Incorrect password'))
    expect(result.title).toBe('Incorrect password')
    expect(result.suggestion).toContain('check your password')
  })

  it('handles non-string, non-Error values', () => {
    const result = parseUnlockError(42)
    expect(result.title).toBe('Unlock failed')
    expect(result.raw).toBe('42')
  })

  it('handles undefined', () => {
    const result = parseUnlockError(undefined)
    expect(result.title).toBe('Unlock failed')
    expect(result.raw).toBe('undefined')
  })

  it('falls back for unknown errors', () => {
    const result = parseUnlockError('Something completely unexpected')
    expect(result.title).toBe('Unlock failed')
    expect(result.suggestion).toBe('Something completely unexpected')
    expect(result.raw).toBe('Something completely unexpected')
  })

  it('hides details when raw matches title (Incorrect password)', () => {
    const result = parseUnlockError('Incorrect password')
    // raw === title, so the details section should not render
    expect(result.raw).toBe(result.title)
  })

  it('shows details when raw differs from title (corruption)', () => {
    const result = parseUnlockError('Invalid wallet file: bad nonce length')
    // raw !== title, so details should be available
    expect(result.raw).not.toBe(result.title)
    expect(result.raw).toBe('Invalid wallet file: bad nonce length')
  })
})
