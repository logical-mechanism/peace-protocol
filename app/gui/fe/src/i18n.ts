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
import onboardingEn from './locales/en/onboarding.json'

import commonEs from './locales/es/common.json'
import walletEs from './locales/es/wallet.json'
import nodeSyncEs from './locales/es/nodeSync.json'
import dashboardEs from './locales/es/dashboard.json'
import settingsEs from './locales/es/settings.json'
import modalsEs from './locales/es/modals.json'
import errorsEs from './locales/es/errors.json'
import notificationsEs from './locales/es/notifications.json'
import onboardingEs from './locales/es/onboarding.json'

import commonFr from './locales/fr/common.json'
import walletFr from './locales/fr/wallet.json'
import nodeSyncFr from './locales/fr/nodeSync.json'
import dashboardFr from './locales/fr/dashboard.json'
import settingsFr from './locales/fr/settings.json'
import modalsFr from './locales/fr/modals.json'
import errorsFr from './locales/fr/errors.json'
import notificationsFr from './locales/fr/notifications.json'
import onboardingFr from './locales/fr/onboarding.json'

import commonDe from './locales/de/common.json'
import walletDe from './locales/de/wallet.json'
import nodeSyncDe from './locales/de/nodeSync.json'
import dashboardDe from './locales/de/dashboard.json'
import settingsDe from './locales/de/settings.json'
import modalsDe from './locales/de/modals.json'
import errorsDe from './locales/de/errors.json'
import notificationsDe from './locales/de/notifications.json'
import onboardingDe from './locales/de/onboarding.json'

import commonZh from './locales/zh/common.json'
import walletZh from './locales/zh/wallet.json'
import nodeSyncZh from './locales/zh/nodeSync.json'
import dashboardZh from './locales/zh/dashboard.json'
import settingsZh from './locales/zh/settings.json'
import modalsZh from './locales/zh/modals.json'
import errorsZh from './locales/zh/errors.json'
import notificationsZh from './locales/zh/notifications.json'
import onboardingZh from './locales/zh/onboarding.json'

import commonJa from './locales/ja/common.json'
import walletJa from './locales/ja/wallet.json'
import nodeSyncJa from './locales/ja/nodeSync.json'
import dashboardJa from './locales/ja/dashboard.json'
import settingsJa from './locales/ja/settings.json'
import modalsJa from './locales/ja/modals.json'
import errorsJa from './locales/ja/errors.json'
import notificationsJa from './locales/ja/notifications.json'
import onboardingJa from './locales/ja/onboarding.json'

import commonKo from './locales/ko/common.json'
import walletKo from './locales/ko/wallet.json'
import nodeSyncKo from './locales/ko/nodeSync.json'
import dashboardKo from './locales/ko/dashboard.json'
import settingsKo from './locales/ko/settings.json'
import modalsKo from './locales/ko/modals.json'
import errorsKo from './locales/ko/errors.json'
import notificationsKo from './locales/ko/notifications.json'
import onboardingKo from './locales/ko/onboarding.json'

import commonPt from './locales/pt/common.json'
import walletPt from './locales/pt/wallet.json'
import nodeSyncPt from './locales/pt/nodeSync.json'
import dashboardPt from './locales/pt/dashboard.json'
import settingsPt from './locales/pt/settings.json'
import modalsPt from './locales/pt/modals.json'
import errorsPt from './locales/pt/errors.json'
import notificationsPt from './locales/pt/notifications.json'
import onboardingPt from './locales/pt/onboarding.json'

import commonTr from './locales/tr/common.json'
import walletTr from './locales/tr/wallet.json'
import nodeSyncTr from './locales/tr/nodeSync.json'
import dashboardTr from './locales/tr/dashboard.json'
import settingsTr from './locales/tr/settings.json'
import modalsTr from './locales/tr/modals.json'
import errorsTr from './locales/tr/errors.json'
import notificationsTr from './locales/tr/notifications.json'
import onboardingTr from './locales/tr/onboarding.json'

import commonId from './locales/id/common.json'
import walletId from './locales/id/wallet.json'
import nodeSyncId from './locales/id/nodeSync.json'
import dashboardId from './locales/id/dashboard.json'
import settingsId from './locales/id/settings.json'
import modalsId from './locales/id/modals.json'
import errorsId from './locales/id/errors.json'
import notificationsId from './locales/id/notifications.json'
import onboardingId from './locales/id/onboarding.json'

import commonVi from './locales/vi/common.json'
import walletVi from './locales/vi/wallet.json'
import nodeSyncVi from './locales/vi/nodeSync.json'
import dashboardVi from './locales/vi/dashboard.json'
import settingsVi from './locales/vi/settings.json'
import modalsVi from './locales/vi/modals.json'
import errorsVi from './locales/vi/errors.json'
import notificationsVi from './locales/vi/notifications.json'
import onboardingVi from './locales/vi/onboarding.json'

import commonNl from './locales/nl/common.json'
import walletNl from './locales/nl/wallet.json'
import nodeSyncNl from './locales/nl/nodeSync.json'
import dashboardNl from './locales/nl/dashboard.json'
import settingsNl from './locales/nl/settings.json'
import modalsNl from './locales/nl/modals.json'
import errorsNl from './locales/nl/errors.json'
import notificationsNl from './locales/nl/notifications.json'
import onboardingNl from './locales/nl/onboarding.json'

import commonRu from './locales/ru/common.json'
import walletRu from './locales/ru/wallet.json'
import nodeSyncRu from './locales/ru/nodeSync.json'
import dashboardRu from './locales/ru/dashboard.json'
import settingsRu from './locales/ru/settings.json'
import modalsRu from './locales/ru/modals.json'
import errorsRu from './locales/ru/errors.json'
import notificationsRu from './locales/ru/notifications.json'
import onboardingRu from './locales/ru/onboarding.json'

export const NAMESPACES = [
  'common',
  'wallet',
  'nodeSync',
  'dashboard',
  'settings',
  'modals',
  'errors',
  'notifications',
  'onboarding',
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
    onboarding: onboardingEn,
  },
  es: {
    common: commonEs,
    wallet: walletEs,
    nodeSync: nodeSyncEs,
    dashboard: dashboardEs,
    settings: settingsEs,
    modals: modalsEs,
    errors: errorsEs,
    notifications: notificationsEs,
    onboarding: onboardingEs,
  },
  fr: {
    common: commonFr,
    wallet: walletFr,
    nodeSync: nodeSyncFr,
    dashboard: dashboardFr,
    settings: settingsFr,
    modals: modalsFr,
    errors: errorsFr,
    notifications: notificationsFr,
    onboarding: onboardingFr,
  },
  de: {
    common: commonDe,
    wallet: walletDe,
    nodeSync: nodeSyncDe,
    dashboard: dashboardDe,
    settings: settingsDe,
    modals: modalsDe,
    errors: errorsDe,
    notifications: notificationsDe,
    onboarding: onboardingDe,
  },
  zh: {
    common: commonZh,
    wallet: walletZh,
    nodeSync: nodeSyncZh,
    dashboard: dashboardZh,
    settings: settingsZh,
    modals: modalsZh,
    errors: errorsZh,
    notifications: notificationsZh,
    onboarding: onboardingZh,
  },
  ja: {
    common: commonJa,
    wallet: walletJa,
    nodeSync: nodeSyncJa,
    dashboard: dashboardJa,
    settings: settingsJa,
    modals: modalsJa,
    errors: errorsJa,
    notifications: notificationsJa,
    onboarding: onboardingJa,
  },
  ko: {
    common: commonKo,
    wallet: walletKo,
    nodeSync: nodeSyncKo,
    dashboard: dashboardKo,
    settings: settingsKo,
    modals: modalsKo,
    errors: errorsKo,
    notifications: notificationsKo,
    onboarding: onboardingKo,
  },
  pt: {
    common: commonPt,
    wallet: walletPt,
    nodeSync: nodeSyncPt,
    dashboard: dashboardPt,
    settings: settingsPt,
    modals: modalsPt,
    errors: errorsPt,
    notifications: notificationsPt,
    onboarding: onboardingPt,
  },
  tr: {
    common: commonTr,
    wallet: walletTr,
    nodeSync: nodeSyncTr,
    dashboard: dashboardTr,
    settings: settingsTr,
    modals: modalsTr,
    errors: errorsTr,
    notifications: notificationsTr,
    onboarding: onboardingTr,
  },
  id: {
    common: commonId,
    wallet: walletId,
    nodeSync: nodeSyncId,
    dashboard: dashboardId,
    settings: settingsId,
    modals: modalsId,
    errors: errorsId,
    notifications: notificationsId,
    onboarding: onboardingId,
  },
  vi: {
    common: commonVi,
    wallet: walletVi,
    nodeSync: nodeSyncVi,
    dashboard: dashboardVi,
    settings: settingsVi,
    modals: modalsVi,
    errors: errorsVi,
    notifications: notificationsVi,
    onboarding: onboardingVi,
  },
  nl: {
    common: commonNl,
    wallet: walletNl,
    nodeSync: nodeSyncNl,
    dashboard: dashboardNl,
    settings: settingsNl,
    modals: modalsNl,
    errors: errorsNl,
    notifications: notificationsNl,
    onboarding: onboardingNl,
  },
  ru: {
    common: commonRu,
    wallet: walletRu,
    nodeSync: nodeSyncRu,
    dashboard: dashboardRu,
    settings: settingsRu,
    modals: modalsRu,
    errors: errorsRu,
    notifications: notificationsRu,
    onboarding: onboardingRu,
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
