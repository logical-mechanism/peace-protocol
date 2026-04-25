import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PreferencesSection from '../PreferencesSection'

vi.mock('../../../services/toastSettings', () => ({
  getToastDurationMs: vi.fn().mockReturnValue(5000),
  setToastDurationMs: vi.fn(),
  TOAST_DURATION_OPTIONS: [
    { labelKey: 'notifDuration3s', value: 3000 },
    { labelKey: 'notifDuration5s', value: 5000 },
  ],
}))

vi.mock('../../../services/notificationSound', () => ({
  previewSound: vi.fn(),
}))

vi.mock('../../../services/soundPreferences', () => ({
  isMasterSoundEnabled: vi.fn().mockReturnValue(true),
  setMasterSoundEnabled: vi.fn(),
  isEventSoundEnabled: vi.fn().mockReturnValue(true),
  setEventSoundEnabled: vi.fn(),
  getEventSoundVolume: vi.fn().mockReturnValue(0.5),
  setEventSoundVolume: vi.fn(),
  SOUND_EVENTS: ['new_bid'],
  SOUND_EVENT_KEYS: {
    new_bid: { labelKey: 'preferences.soundEvents.new_bid', descKey: 'preferences.soundEvents.new_bidDesc' },
  },
}))

vi.mock('../../../services/desktopNotifications', () => ({
  isDesktopNotificationsEnabled: vi.fn().mockReturnValue(false),
  setDesktopNotificationsEnabled: vi.fn(),
  sendDesktopNotification: vi.fn(),
}))

vi.mock('../../../services/themeStorage', () => ({
  getTheme: vi.fn().mockReturnValue('dark'),
  setTheme: vi.fn(),
  applyTheme: vi.fn(),
  listenToSystemTheme: vi.fn().mockReturnValue(() => {}),
}))

vi.mock('../../../services/nsfwStorage', () => ({
  getNsfwEnabled: vi.fn().mockReturnValue(false),
  setNsfwEnabled: vi.fn(),
}))

describe('PreferencesSection', () => {
  it('renders all five sub-sections', () => {
    render(<PreferencesSection />)
    expect(screen.getByRole('heading', { name: 'Theme' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'NSFW Content' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notification Duration' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Desktop Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Notification Sounds' })).toBeInTheDocument()
  })
})
