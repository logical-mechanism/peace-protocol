import { describe, it, expect } from 'vitest'
import { formatElapsedTime, formatEta, formatSpeed, getErrorGuidance } from '../../utils/nodeSyncHelpers'

describe('formatElapsedTime', () => {
  it('returns MM:SS for durations under 1 hour', () => {
    expect(formatElapsedTime(0)).toBe('0:00')
    expect(formatElapsedTime(5)).toBe('0:05')
    expect(formatElapsedTime(45)).toBe('0:45')
    expect(formatElapsedTime(60)).toBe('1:00')
    expect(formatElapsedTime(599)).toBe('9:59')
    expect(formatElapsedTime(3599)).toBe('59:59')
  })

  it('returns Xh Ym Zs for durations of 1 hour or more', () => {
    expect(formatElapsedTime(3600)).toBe('1h 0m 0s')
    expect(formatElapsedTime(3601)).toBe('1h 0m 1s')
    expect(formatElapsedTime(3661)).toBe('1h 1m 1s')
    expect(formatElapsedTime(7200)).toBe('2h 0m 0s')
    expect(formatElapsedTime(9132)).toBe('2h 32m 12s')
  })

  it('handles large durations', () => {
    expect(formatElapsedTime(86399)).toBe('23h 59m 59s')
    expect(formatElapsedTime(86400)).toBe('24h 0m 0s')
  })
})

describe('formatEta', () => {
  it('returns "less than a minute" for < 60 seconds', () => {
    expect(formatEta(0)).toBe('less than a minute remaining')
    expect(formatEta(30)).toBe('less than a minute remaining')
    expect(formatEta(59)).toBe('less than a minute remaining')
  })

  it('returns minutes for < 1 hour', () => {
    expect(formatEta(60)).toBe('~1 min remaining')
    expect(formatEta(90)).toBe('~2 min remaining')
    expect(formatEta(300)).toBe('~5 min remaining')
    expect(formatEta(3540)).toBe('~59 min remaining')
  })

  it('returns hours and minutes for >= 1 hour', () => {
    expect(formatEta(3600)).toBe('~1h 0m remaining')
    expect(formatEta(3660)).toBe('~1h 1m remaining')
    expect(formatEta(7200)).toBe('~2h 0m remaining')
    expect(formatEta(5400)).toBe('~1h 30m remaining')
  })

  it('rounds minutes up (ceiling)', () => {
    expect(formatEta(61)).toBe('~2 min remaining')
    expect(formatEta(121)).toBe('~3 min remaining')
  })
})

describe('formatSpeed', () => {
  it('returns KB/s for < 1 MB/s', () => {
    expect(formatSpeed(512 * 1024)).toBe('512 KB/s')
    expect(formatSpeed(1024)).toBe('1 KB/s')
    expect(formatSpeed(100 * 1024)).toBe('100 KB/s')
  })

  it('returns MB/s for >= 1 MB/s', () => {
    expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s')
    expect(formatSpeed(10.5 * 1024 * 1024)).toBe('10.5 MB/s')
    expect(formatSpeed(100 * 1024 * 1024)).toBe('100.0 MB/s')
  })

  it('rounds KB/s to whole number', () => {
    expect(formatSpeed(1536)).toBe('2 KB/s')
  })

  it('rounds MB/s to one decimal', () => {
    expect(formatSpeed(1.55 * 1024 * 1024)).toBe('1.6 MB/s')
  })
})

describe('getErrorGuidance', () => {
  it('returns generic guidance for null error', () => {
    const result = getErrorGuidance(null)
    expect(result.title).toBe('An error occurred')
    expect(result.steps.length).toBeGreaterThan(0)
  })

  it('detects disk space errors', () => {
    expect(getErrorGuidance('ENOSPC: no space left on device').title).toBe('Disk space is full')
    expect(getErrorGuidance('disk full error').title).toBe('Disk space is full')
    expect(getErrorGuidance('No space on volume').title).toBe('Disk space is full')
  })

  it('detects port conflict errors', () => {
    expect(getErrorGuidance('EADDRINUSE: address already in use :::3001').title).toBe('Port conflict detected')
    expect(getErrorGuidance('Error: address already in use').title).toBe('Port conflict detected')
  })

  it('detects connection refused errors', () => {
    expect(getErrorGuidance('ECONNREFUSED 127.0.0.1:44203').title).toBe('Connection refused')
    expect(getErrorGuidance('Connection refused by server').title).toBe('Connection refused')
  })

  it('detects process crash errors', () => {
    expect(getErrorGuidance('cardano-node: exited with signal SIGKILL').title).toBe('Process crashed unexpectedly')
    expect(getErrorGuidance('Process killed unexpectedly').title).toBe('Process crashed unexpectedly')
    expect(getErrorGuidance('ogmios: exited with code 1').title).toBe('Process crashed unexpectedly')
    expect(getErrorGuidance('Service crash detected').title).toBe('Process crashed unexpectedly')
  })

  it('detects permission errors', () => {
    expect(getErrorGuidance('EACCES: permission denied').title).toBe('Permission denied')
    expect(getErrorGuidance('Permission denied on file').title).toBe('Permission denied')
  })

  it('detects timeout errors', () => {
    expect(getErrorGuidance('Operation timed out after 30s').title).toBe('Operation timed out')
    expect(getErrorGuidance('Timeout waiting for response').title).toBe('Operation timed out')
  })

  it('returns generic fallback for unknown errors', () => {
    const result = getErrorGuidance('Something completely unexpected happened')
    expect(result.title).toBe('An error occurred')
    expect(result.steps.length).toBe(3)
  })

  it('is case-insensitive', () => {
    expect(getErrorGuidance('DISK FULL').title).toBe('Disk space is full')
    expect(getErrorGuidance('Enospc').title).toBe('Disk space is full')
  })

  it('always returns non-empty steps', () => {
    const testErrors = [
      null,
      '',
      'ENOSPC',
      'EADDRINUSE',
      'ECONNREFUSED',
      'killed',
      'EACCES',
      'timeout',
      'unknown error',
    ]
    for (const err of testErrors) {
      const result = getErrorGuidance(err)
      expect(result.steps.length).toBeGreaterThan(0)
      expect(result.title.length).toBeGreaterThan(0)
    }
  })
})
