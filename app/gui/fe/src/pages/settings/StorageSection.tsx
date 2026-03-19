import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getTransactions, clearHistory, clearOlderThan, clearFailed } from '../../services/transactionHistory'
import { listCachedImages, deleteCachedImage, type ImageCacheStatus } from '../../services/imageCache'
import { apiCache } from '../../services/apiCache'
import { formatBytes } from '../../utils/formatBytes'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../components/Toast'
import { type DiskUsage } from './settingsTypes'

interface StorageSectionProps {
  userPkh: string | undefined
}

export default function StorageSection({
  userPkh,
}: StorageSectionProps) {
  // Suppress unused variable warning — toast is used by subcomponents pattern
  const _toast = useToast()
  void _toast

  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null)
  const [imageCacheStatus, setImageCacheStatus] = useState<ImageCacheStatus | null>(null)
  const [cacheDeleting, setCacheDeleting] = useState<string | null>(null)
  const [cacheClearingAll, setCacheClearingAll] = useState(false)
  const [cacheConfirmClearAll, setCacheConfirmClearAll] = useState(false)
  const [txHistoryCount, setTxHistoryCount] = useState(0)
  const [txClearConfirm, setTxClearConfirm] = useState(false)
  const [apiCacheSize, setApiCacheSize] = useState(0)

  // Load data on mount
  useEffect(() => {
    invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)
    listCachedImages().then(setImageCacheStatus).catch(console.error)
    setApiCacheSize(apiCache.size)
    if (userPkh) {
      setTxHistoryCount(getTransactions(userPkh).length)
    }
  }, [userPkh])

  const handleDeleteCachedImage = useCallback(async (tokenName: string) => {
    setCacheDeleting(tokenName)
    try {
      await deleteCachedImage(tokenName)
      const updated = await listCachedImages()
      setImageCacheStatus(updated)
    } catch (err) {
      console.error('Failed to delete cached image:', err)
    } finally {
      setCacheDeleting(null)
    }
  }, [])

  const handleClearAllCache = useCallback(async () => {
    if (!imageCacheStatus) return
    setCacheConfirmClearAll(false)
    setCacheClearingAll(true)
    try {
      for (const tokenName of imageCacheStatus.cached) {
        await deleteCachedImage(tokenName)
      }
      setImageCacheStatus(prev => prev ? { ...prev, cached: [], total_bytes: 0 } : prev)
    } catch (err) {
      console.error('Failed to clear image cache:', err)
    } finally {
      setCacheClearingAll(false)
    }
  }, [imageCacheStatus])

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-4">Disk Usage</h2>

          {diskUsage ? (
            (() => {
              const otherBytes = Math.max(0, diskUsage.total_bytes - diskUsage.chain_data_bytes - diskUsage.snark_data_bytes - diskUsage.wallet_bytes)
              const segments = [
                { label: 'Chain Data', bytes: diskUsage.chain_data_bytes, color: 'var(--accent)' },
                { label: 'SNARK Setup', bytes: diskUsage.snark_data_bytes, color: 'var(--warning)' },
                { label: 'Wallet', bytes: diskUsage.wallet_bytes, color: 'var(--success)' },
                ...(otherBytes > 0 ? [{ label: 'Other', bytes: otherBytes, color: 'var(--text-muted)' }] : []),
              ]
              const total = diskUsage.total_bytes || 1
              return (
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Data Directory</span>
                    <code className="block text-sm font-mono mt-1 bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all">
                      {diskUsage.data_dir}
                    </code>
                  </div>

                  {/* Stacked bar chart */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-[var(--text-muted)]">Usage Breakdown</span>
                      <span className="text-sm font-medium">{formatBytes(diskUsage.total_bytes)}</span>
                    </div>
                    <div className="h-6 rounded-full overflow-hidden flex bg-[var(--bg-secondary)]">
                      {segments.map((seg) => {
                        const pct = (seg.bytes / total) * 100
                        if (pct < 0.5) return null
                        return (
                          <div
                            key={seg.label}
                            className="h-full transition-all duration-300"
                            style={{ width: `${pct}%`, backgroundColor: seg.color }}
                            title={`${seg.label}: ${formatBytes(seg.bytes)} (${pct.toFixed(1)}%)`}
                          />
                        )
                      })}
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="grid grid-cols-2 gap-3">
                    {segments.map((seg) => (
                      <div key={seg.label} className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-sm shrink-0"
                          style={{ backgroundColor: seg.color }}
                        />
                        <span className="text-sm text-[var(--text-muted)]">{seg.label}</span>
                        <span className="text-sm font-medium ml-auto">{formatBytes(seg.bytes)}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={() => invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)}
                    className="mt-2 px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                  >
                    Refresh
                  </button>
                </div>
              )
            })()
          ) : (
            <p className="text-[var(--text-muted)]">Loading...</p>
          )}
        </div>

        {/* Image Cache */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Image Cache</h2>
            <div className="flex gap-2">
              <button
                onClick={() => listCachedImages().then(setImageCacheStatus).catch(console.error)}
                className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
                aria-label="Refresh image cache status"
              >
                Refresh
              </button>
              {imageCacheStatus && imageCacheStatus.cached.length > 0 && (
                <button
                  onClick={() => setCacheConfirmClearAll(true)}
                  disabled={cacheClearingAll}
                  className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
                >
                  {cacheClearingAll ? 'Clearing...' : 'Clear All'}
                </button>
              )}
            </div>
          </div>

          {imageCacheStatus ? (
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] flex-1">
                  <span className="text-sm text-[var(--text-muted)]">Cached</span>
                  <p className="text-lg font-medium">{imageCacheStatus.cached.length} image{imageCacheStatus.cached.length !== 1 ? 's' : ''}</p>
                  {imageCacheStatus.total_bytes > 0 && (
                    <p className="text-sm text-[var(--text-muted)]">{formatBytes(imageCacheStatus.total_bytes)}</p>
                  )}
                </div>
                <div className="p-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] flex-1">
                  <span className="text-sm text-[var(--text-muted)]">Banned</span>
                  <p className="text-lg font-medium">{imageCacheStatus.banned.length} image{imageCacheStatus.banned.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

              {imageCacheStatus.cached.length > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {imageCacheStatus.cached.map(tokenName => (
                    <div key={tokenName} className="flex items-center justify-between py-1.5 px-3 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <code className="text-xs font-mono text-[var(--text-secondary)] truncate mr-3">
                        {tokenName.length > 24 ? `${tokenName.slice(0, 12)}...${tokenName.slice(-12)}` : tokenName}
                      </code>
                      <button
                        onClick={() => handleDeleteCachedImage(tokenName)}
                        disabled={cacheDeleting === tokenName}
                        className="px-2 py-1 text-xs rounded shrink-0 btn-base btn-destructive"
                        aria-label={`Delete cached image ${tokenName}`}
                      >
                        {cacheDeleting === tokenName ? '...' : 'Delete'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] text-center py-2">No cached images.</p>
              )}
            </div>
          ) : (
            <p className="text-[var(--text-muted)]">Loading...</p>
          )}
        </div>

        {/* API Response Cache */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-medium">API Response Cache</h2>
            <button
              onClick={() => {
                apiCache.clear()
                setApiCacheSize(0)
              }}
              disabled={apiCacheSize === 0}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
            >
              Clear
            </button>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            {apiCacheSize} cached response{apiCacheSize !== 1 ? 's' : ''} (in-memory, auto-expires after 15s).
          </p>
        </div>

        {/* Transaction History */}
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Transaction History</h2>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            {txHistoryCount} transaction{txHistoryCount !== 1 ? 's' : ''} stored locally.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setTxClearConfirm(true)}
              disabled={!userPkh || txHistoryCount === 0}
              className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-destructive"
            >
              Clear All
            </button>
            <button
              onClick={() => {
                if (!userPkh) return
                const removed = clearOlderThan(userPkh, 30)
                setTxHistoryCount(prev => prev - removed)
              }}
              disabled={!userPkh || txHistoryCount === 0}
              className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
            >
              Clear Older Than 30 Days
            </button>
            <button
              onClick={() => {
                if (!userPkh) return
                const removed = clearFailed(userPkh)
                setTxHistoryCount(prev => prev - removed)
              }}
              disabled={!userPkh || txHistoryCount === 0}
              className="px-4 py-2 text-sm rounded-[var(--radius-md)] btn-base btn-tertiary"
            >
              Clear Failed Only
            </button>
          </div>
        </div>
      </div>

      {/* Image Cache Clear Confirmation */}
      <ConfirmModal
        isOpen={cacheConfirmClearAll}
        onClose={() => setCacheConfirmClearAll(false)}
        onConfirm={handleClearAllCache}
        title="Clear Image Cache"
        message={`Delete all ${imageCacheStatus?.cached.length ?? 0} cached image${(imageCacheStatus?.cached.length ?? 0) !== 1 ? 's' : ''}${imageCacheStatus?.total_bytes ? ` (${formatBytes(imageCacheStatus.total_bytes)})` : ''}? They will be re-downloaded when needed.`}
        confirmLabel="Clear Cache"
        confirmVariant="danger"
        loading={cacheClearingAll}
      />

      {/* Transaction History Clear Confirmation */}
      <ConfirmModal
        isOpen={txClearConfirm}
        onClose={() => setTxClearConfirm(false)}
        onConfirm={() => {
          if (!userPkh) return
          setTxClearConfirm(false)
          clearHistory(userPkh)
          setTxHistoryCount(0)
        }}
        title="Clear Transaction History"
        message="Clear all locally recorded transaction history? This cannot be undone."
        confirmLabel="Clear All"
        confirmVariant="danger"
      />
    </>
  )
}
