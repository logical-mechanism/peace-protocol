import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import '../../i18n'
import { invoke } from '@tauri-apps/api/core'
import { getLogLineClass } from '../../utils/logClassification'
import { type ProcessLog } from './settingsTypes'

interface LogsSectionProps {
  processes: Array<{ name: string; pid: number | null }>
}

export default function LogsSection({
  processes,
}: LogsSectionProps) {
  const { t } = useTranslation('settings')
  const [selectedProcess, setSelectedProcess] = useState<string>('cardano-node')
  const [processLogs, setProcessLogs] = useState<ProcessLog | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logSearchQuery, setLogSearchQuery] = useState('')

  const filteredLogLines = useMemo(() => {
    if (!processLogs?.lines.length) return []
    if (!logSearchQuery.trim()) return processLogs.lines
    const query = logSearchQuery.toLowerCase()
    return processLogs.lines.filter(line => line.toLowerCase().includes(query))
  }, [processLogs, logSearchQuery])

  // Developer debug mode
  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('veiled_debug_mode') === 'true')
  const [appConfig, setAppConfig] = useState<Record<string, unknown> | null>(null)
  const [localStorageKeys, setLocalStorageKeys] = useState<string[]>([])

  const handleFetchLogs = useCallback(async (processName: string) => {
    setLogsLoading(true)
    try {
      const lines = await invoke<string[]>('get_process_logs', {
        processName,
        lines: 200,
      })
      setProcessLogs({ name: processName, lines })
    } catch (error) {
      console.error('Failed to fetch logs:', error)
      setProcessLogs({ name: processName, lines: [t('logs.logError', { error: String(error) })] })
    } finally {
      setLogsLoading(false)
    }
  }, [t])

  const handleToggleDebug = useCallback((enabled: boolean) => {
    setDebugMode(enabled)
    localStorage.setItem('veiled_debug_mode', String(enabled))
  }, [])

  // Load logs on mount and when selected process changes
  useEffect(() => {
    handleFetchLogs(selectedProcess)
  }, [selectedProcess, handleFetchLogs])

  // Load debug info when debug mode is active
  useEffect(() => {
    if (debugMode) {
      invoke<Record<string, unknown>>('get_app_config').then(setAppConfig).catch(console.error)
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) keys.push(key)
      }
      setLocalStorageKeys(keys.sort())
    }
  }, [debugMode])

  return (
    <div className="space-y-6">
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">{t('logs.processLogsTitle')}</h2>
          <button
            onClick={() => handleFetchLogs(selectedProcess)}
            disabled={logsLoading}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
          >
            {logsLoading ? t('logs.loading') : t('logs.refresh')}
          </button>
        </div>

        {/* Process Selector */}
        <div className="flex gap-2 mb-4">
          {['cardano-node', 'ogmios', 'kupo', 'express', 'mithril-client'].map((name) => (
            <button
              key={name}
              onClick={() => { setSelectedProcess(name); setLogSearchQuery('') }}
              className={`px-3 py-1.5 text-xs font-mono rounded-[var(--radius-md)] transition-colors cursor-pointer ${
                selectedProcess === name
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        {/* Log Search */}
        <div className="mb-4">
          <input
            type="text"
            value={logSearchQuery}
            onChange={(e) => setLogSearchQuery(e.target.value)}
            placeholder={t('logs.searchPlaceholder')}
            className="w-full px-3 py-2 text-sm font-mono bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          {logSearchQuery && (
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {t('logs.searchMatches', { matching: filteredLogLines.length, total: processLogs?.lines.length ?? 0 })}
            </div>
          )}
        </div>

        {/* Log Output */}
        <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 font-mono text-xs max-h-96 overflow-y-auto">
          {filteredLogLines.length ? (
            filteredLogLines.map((line, i) => (
              <div
                key={i}
                className={`py-0.5 break-all ${getLogLineClass(line)}`}
              >
                {line}
              </div>
            ))
          ) : logsLoading ? (
            <div className="space-y-2">
              <div className="h-3 w-4/5 rounded skeleton-shimmer" />
              <div className="h-3 w-3/5 rounded skeleton-shimmer" />
              <div className="h-3 w-full rounded skeleton-shimmer" />
              <div className="h-3 w-2/3 rounded skeleton-shimmer" />
              <div className="h-3 w-3/4 rounded skeleton-shimmer" />
            </div>
          ) : (
            <p className="text-[var(--text-muted)]">
              {logSearchQuery ? t('logs.noMatchingLines') : t('logs.noLogsAvailable')}
            </p>
          )}
        </div>
      </div>

      {/* Developer Mode */}
      <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-medium">{t('logs.developerModeTitle')}</h2>
            <p className="text-sm text-[var(--text-muted)]">
              {t('logs.developerModeDescription')}
            </p>
          </div>
          <button
            onClick={() => handleToggleDebug(!debugMode)}
            className={`relative w-12 h-6 rounded-full transition-colors cursor-pointer ${
              debugMode ? 'bg-[var(--accent)]' : 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
            }`}
            role="switch"
            aria-checked={debugMode}
            aria-label={t('logs.toggleAria')}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              debugMode ? 'translate-x-6' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {debugMode && (
          <div className="space-y-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
            {/* App Config */}
            <div>
              <h3 className="text-sm font-medium mb-2">{t('logs.appConfigTitle')}</h3>
              <pre className="text-xs font-mono bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3 max-h-48 overflow-auto text-[var(--text-secondary)]">
                {appConfig ? JSON.stringify(appConfig, null, 2) : t('logs.appConfigLoading')}
              </pre>
            </div>

            {/* Process PIDs */}
            <div>
              <h3 className="text-sm font-medium mb-2">{t('logs.processPidsTitle')}</h3>
              <div className="grid grid-cols-3 gap-2">
                {processes.map(proc => (
                  <div key={proc.name} className="p-2 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                    <span className="text-xs text-[var(--text-muted)]">{proc.name}</span>
                    <p className="text-sm font-mono">{proc.pid || t('logs.pidNa')}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* localStorage Keys */}
            <div>
              <h3 className="text-sm font-medium mb-2">{t('logs.localStorageKeysTitle', { count: localStorageKeys.length })}</h3>
              <div className="max-h-48 overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-3">
                {localStorageKeys.length > 0 ? (
                  localStorageKeys.map(key => (
                    <div key={key} className="text-xs font-mono text-[var(--text-secondary)] py-0.5">
                      {key}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-[var(--text-muted)]">{t('logs.noLocalStorageKeys')}</p>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
              >
                {t('logs.forceRefresh')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
