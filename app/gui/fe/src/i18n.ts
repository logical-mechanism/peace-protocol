/**
 * i18next configuration. Imported for side effects from main.tsx *after*
 * `initializeLanguage()` has seeded localStorage from the OS locale, so
 * the LanguageDetector's localStorage probe returns a resolved language.
 *
 * Namespaces live under `locales/<lang>/<namespace>.json` and are imported
 * eagerly. English is the only language today; adding a new language means
 * dropping in a `locales/<code>/` directory and appending the code to
 * `AVAILABLE_LANGUAGES` in `services/languageStorage.ts`.
 */
import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import commonEn from './locales/en/common.json'
import walletEn from './locales/en/wallet.json'
import nodeSyncEn from './locales/en/nodeSync.json'
import dashboardEn from './locales/en/dashboard.json'
import settingsEn from './locales/en/settings.json'
import modalsEn from './locales/en/modals.json'
import errorsEn from './locales/en/errors.json'
import notificationsEn from './locales/en/notifications.json'

export const NAMESPACES = [
  'common',
  'wallet',
  'nodeSync',
  'dashboard',
  'settings',
  'modals',
  'errors',
  'notifications',
] as const

export const resources = {
  en: {
    common: commonEn,
    wallet: walletEn,
    nodeSync: nodeSyncEn,
    dashboard: dashboardEn,
    settings: settingsEn,
    modals: modalsEn,
    errors: errorsEn,
    notifications: notificationsEn,
  },
} as const

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: NAMESPACES as unknown as string[],
    detection: {
      // Prefer the value we seeded from the OS locale in initializeLanguage().
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'veiled_language',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  })

export default i18n
