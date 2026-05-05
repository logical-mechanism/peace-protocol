import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { AVAILABLE_LANGUAGES, getLanguage, setLanguage, type LanguageCode } from '../../services/languageStorage'
import { getToastDurationMs, setToastDurationMs, TOAST_DURATION_OPTIONS } from '../../services/toastSettings'
import { previewSound } from '../../services/notificationSound'
import {
  isMasterSoundEnabled, setMasterSoundEnabled,
  isEventSoundEnabled, setEventSoundEnabled,
  getEventSoundVolume, setEventSoundVolume,
  SOUND_EVENTS, SOUND_EVENT_KEYS,
  type SoundEvent,
} from '../../services/soundPreferences'
import { isDesktopNotificationsEnabled, setDesktopNotificationsEnabled, sendDesktopNotification } from '../../services/desktopNotifications'
import { getTheme, setTheme, applyTheme, listenToSystemTheme, type Theme } from '../../services/themeStorage'
import { getNsfwEnabled, setNsfwEnabled } from '../../services/nsfwStorage'
import Select from '../../components/Select'

export default function PreferencesSection() {
  const { t } = useTranslation('settings')
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getTheme())
  const [currentLanguage, setCurrentLanguage] = useState<LanguageCode>(() => getLanguage())

  // Re-apply theme on OS dark/light change while 'system' is selected.
  useEffect(() => {
    if (currentTheme !== 'system') return
    return listenToSystemTheme(() => applyTheme('system'))
  }, [currentTheme])

  const [showNsfw, setShowNsfw] = useState(() => getNsfwEnabled())
  const [toastDuration, setToastDuration] = useState(() => getToastDurationMs())
  const [masterSoundEnabled, setMasterSoundEnabledState] = useState(() => isMasterSoundEnabled())
  const [eventEnabled, setEventEnabledState] = useState<Record<SoundEvent, boolean>>(() => {
    const initial = {} as Record<SoundEvent, boolean>
    for (const e of SOUND_EVENTS) initial[e] = isEventSoundEnabled(e)
    return initial
  })
  const [eventVolume, setEventVolumeState] = useState<Record<SoundEvent, number>>(() => {
    const initial = {} as Record<SoundEvent, number>
    for (const e of SOUND_EVENTS) initial[e] = getEventSoundVolume(e)
    return initial
  })
  const [desktopNotifEnabled, setDesktopNotifEnabledState] = useState(() => isDesktopNotificationsEnabled())

  return (
    <div className="space-y-6">
      {/* Language */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-2">{t('language.title')}</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t('language.description')}
        </p>
        <div className="max-w-xs">
          <Select
            value={currentLanguage}
            options={AVAILABLE_LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
            onChange={(next) => {
              const code = next as LanguageCode
              setCurrentLanguage(code)
              setLanguage(code)
              void i18n.changeLanguage(code)
            }}
            ariaLabel={t('language.selectLabel')}
          />
        </div>
      </div>

      {/* Theme */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-2">{t('preferences.themeTitle')}</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t('preferences.themeDescription')}
        </p>
        <div className="flex gap-2">
          {([
            { label: t('preferences.themeDark'), value: 'dark' as Theme },
            { label: t('preferences.themeLight'), value: 'light' as Theme },
            { label: t('preferences.themeSystem'), value: 'system' as Theme },
          ] as const).map((option) => (
            <button
              key={option.value}
              onClick={() => {
                setCurrentTheme(option.value)
                setTheme(option.value)
                applyTheme(option.value)
              }}
              className={`px-4 py-2 text-sm rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                currentTheme === option.value
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* NSFW Content */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-2">{t('preferences.nsfwTitle')}</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t('preferences.nsfwDescription')}
        </p>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <button
            onClick={() => {
              const next = !showNsfw
              setShowNsfw(next)
              setNsfwEnabled(next)
            }}
            className={`relative w-11 h-6 rounded-full transition-colors duration-[var(--transition-fast)] cursor-pointer ${
              showNsfw ? 'bg-[var(--accent)]' : 'bg-[var(--bg-elevated)]'
            }`}
            role="switch"
            aria-checked={showNsfw}
            aria-label={t('preferences.nsfwToggleAria')}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-[var(--transition-fast)] ${
              showNsfw ? 'translate-x-5' : ''
            }`} />
          </button>
          <span className="text-sm text-[var(--text-primary)]">{t('preferences.nsfwLabel')}</span>
        </label>
      </div>

      {/* Notification Duration */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <h2 className="text-lg font-medium mb-2">{t('preferences.notifDurationTitle')}</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {t('preferences.notifDurationDescription')}
        </p>
        <div className="max-w-xs">
          <Select
            value={String(toastDuration)}
            options={TOAST_DURATION_OPTIONS.map((opt) => ({ value: String(opt.value), label: t(`preferences.${opt.labelKey}`) }))}
            onChange={(v) => {
              const ms = Number(v)
              setToastDuration(ms)
              setToastDurationMs(ms)
            }}
            ariaLabel={t('preferences.notifDurationAria')}
          />
        </div>
      </div>

      {/* Desktop Notifications */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">{t('preferences.desktopNotifTitle')}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {t('preferences.desktopNotifDescription')}
            </p>
          </div>
          <button
            onClick={() => {
              const next = !desktopNotifEnabled
              setDesktopNotifEnabledState(next)
              setDesktopNotificationsEnabled(next)
              if (next) {
                sendDesktopNotification(t('preferences.desktopNotifTestTitle'), t('preferences.desktopNotifTestBody'))
              }
            }}
            className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
              desktopNotifEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
            }`}
            role="switch"
            aria-checked={desktopNotifEnabled}
            aria-label={t('preferences.desktopNotifToggleAria')}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              desktopNotifEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>
      </div>

      {/* Notification Sounds */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium">{t('preferences.notifSoundsTitle')}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {t('preferences.notifSoundsDescription')}
            </p>
          </div>
          <button
            onClick={() => {
              const next = !masterSoundEnabled
              setMasterSoundEnabledState(next)
              setMasterSoundEnabled(next)
              if (next) previewSound('new_bid')
            }}
            className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
              masterSoundEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
            }`}
            role="switch"
            aria-checked={masterSoundEnabled}
            aria-label={t('preferences.notifSoundsToggleAria')}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              masterSoundEnabled ? 'translate-x-5' : 'translate-x-0'
            }`} />
          </button>
        </div>
        {masterSoundEnabled && (
          <div className="space-y-4">
            {SOUND_EVENTS.map(event => {
              const { labelKey, descKey } = SOUND_EVENT_KEYS[event]
              const label = t(labelKey)
              const description = t(descKey)
              const enabled = eventEnabled[event]
              const volume = eventVolume[event]
              return (
                <div key={event} className="border-t border-[var(--border-subtle)] pt-4 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{label}</span>
                      <p className="text-xs text-[var(--text-muted)]">{description}</p>
                    </div>
                    <button
                      onClick={() => {
                        const next = !enabled
                        setEventEnabledState(prev => ({ ...prev, [event]: next }))
                        setEventSoundEnabled(event, next)
                        if (next) previewSound(event, volume)
                      }}
                      className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                        enabled ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
                      }`}
                      role="switch"
                      aria-checked={enabled}
                      aria-label={t('preferences.eventSoundToggleAria', { label })}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                        enabled ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                  {enabled && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text-secondary)]">{t('preferences.volumeLabel')}</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.1}
                        value={volume}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setEventVolumeState(prev => ({ ...prev, [event]: v }))
                          setEventSoundVolume(event, v)
                        }}
                        onMouseUp={() => previewSound(event, volume)}
                        className="flex-1 accent-[var(--accent)]"
                      />
                      <span className="text-xs text-[var(--text-muted)] w-8 text-right">
                        {Math.round(volume * 100)}%
                      </span>
                      <button
                        onClick={() => previewSound(event, volume)}
                        className="px-2 py-1 text-xs rounded-[var(--radius-sm)] btn-base btn-tertiary flex-shrink-0"
                        aria-label={t('preferences.previewSoundAria', { label })}
                      >
                        &#9654;
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
