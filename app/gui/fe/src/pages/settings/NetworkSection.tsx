import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../components/Toast'

interface NetworkSectionProps {
  currentNetwork: string
  stage: string
  stopNode: () => Promise<void> | void
  setCurrentNetwork: (network: string) => void
}

export default function NetworkSection({
  currentNetwork,
  stage,
  stopNode,
  setCurrentNetwork,
}: NetworkSectionProps) {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const navigate = useNavigate()
  const [networkSwitching, setNetworkSwitching] = useState(false)
  const [networkConfirmTarget, setNetworkConfirmTarget] = useState<string | null>(null)

  const handleNetworkSwitch = useCallback(async () => {
    if (!networkConfirmTarget || networkConfirmTarget === currentNetwork) return

    setNetworkSwitching(true)
    try {
      await invoke('set_network', { network: networkConfirmTarget })
      setCurrentNetwork(networkConfirmTarget)
      await stopNode()
      setNetworkConfirmTarget(null)
      toast.success(
        t('network.switchedToast', { network: networkConfirmTarget }),
        t('network.switchedToastBody'),
      )
      navigate('/')
    } catch (error) {
      console.error('Failed to switch network:', error)
      toast.error(t('network.switchFailedToast'), `${error}`)
    } finally {
      setNetworkSwitching(false)
    }
  }, [currentNetwork, networkConfirmTarget, toast, stopNode, setCurrentNetwork, navigate, t])

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">{t('network.title')}</h2>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            {t('network.description')}
          </p>

          <div className="grid grid-cols-2 gap-4">
            {['preprod', 'mainnet'].map((net) => (
              <button
                key={net}
                onClick={() => net !== currentNetwork && setNetworkConfirmTarget(net)}
                disabled={networkSwitching || net === currentNetwork || (stage !== 'stopped' && stage !== 'synced')}
                className={`p-4 rounded-[var(--radius-lg)] border-2 transition-all cursor-pointer ${
                  currentNetwork === net
                    ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
                } ${networkSwitching || (stage !== 'stopped' && stage !== 'synced') ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="text-left">
                  <h3 className="text-lg font-medium capitalize">{net}</h3>
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    {net === 'preprod'
                      ? t('network.preprodDescription')
                      : t('network.mainnetDescription')}
                  </p>
                  {currentNetwork === net && (
                    <span className="inline-block mt-2 text-xs text-[var(--accent)]">{t('network.currentBadge')}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {stage !== 'stopped' && stage !== 'synced' && (
            <p className="text-xs text-[var(--text-muted)] mt-3">
              {t('network.stopNodeHint')}
            </p>
          )}
        </div>
      </div>

      {/* Network Switch Confirmation */}
      <ConfirmModal
        isOpen={networkConfirmTarget !== null}
        onClose={() => setNetworkConfirmTarget(null)}
        onConfirm={handleNetworkSwitch}
        title={t('network.confirmTitle')}
        message={t('network.confirmMessage', { network: networkConfirmTarget ?? '' })}
        description={t('network.confirmDescription')}
        confirmLabel={t('network.confirmButton')}
        confirmVariant="default"
        loading={networkSwitching}
      />
    </>
  )
}
