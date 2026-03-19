import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../components/Toast'

interface NetworkSectionProps {
  currentNetwork: string
  stage: string
  stopNode: () => void
  setCurrentNetwork: (network: string) => void
}

export default function NetworkSection({
  currentNetwork,
  stage,
  stopNode,
  setCurrentNetwork,
}: NetworkSectionProps) {
  const toast = useToast()
  const [networkSwitching, setNetworkSwitching] = useState(false)
  const [networkConfirmTarget, setNetworkConfirmTarget] = useState<string | null>(null)

  const handleNetworkSwitch = useCallback(async () => {
    if (!networkConfirmTarget || networkConfirmTarget === currentNetwork) return

    setNetworkSwitching(true)
    try {
      await invoke('set_network', { network: networkConfirmTarget })
      setCurrentNetwork(networkConfirmTarget)
      setNetworkConfirmTarget(null)
      toast.success(
        `Network switched to ${networkConfirmTarget}`,
        'Please restart the application for changes to take effect.',
        0,
        { label: 'Stop Node', onClick: () => { stopNode() } }
      )
    } catch (error) {
      console.error('Failed to switch network:', error)
      toast.error('Network switch failed', `${error}`)
    } finally {
      setNetworkSwitching(false)
    }
  }, [currentNetwork, networkConfirmTarget, toast, stopNode, setCurrentNetwork])

  return (
    <>
      <div className="space-y-6">
        <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
          <h2 className="text-lg font-medium mb-2">Network Selection</h2>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            Switching networks requires a full restart. Each network uses a separate chain data directory.
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
                      ? 'Test network (~4GB RAM, ~30GB disk)'
                      : 'Production network (~8GB RAM, ~300GB disk)'}
                  </p>
                  {currentNetwork === net && (
                    <span className="inline-block mt-2 text-xs text-[var(--accent)]">Current</span>
                  )}
                </div>
              </button>
            ))}
          </div>
          {stage !== 'stopped' && stage !== 'synced' && (
            <p className="text-xs text-[var(--text-muted)] mt-3">
              Stop the node before switching networks.
            </p>
          )}
        </div>
      </div>

      {/* Network Switch Confirmation */}
      <ConfirmModal
        isOpen={networkConfirmTarget !== null}
        onClose={() => setNetworkConfirmTarget(null)}
        onConfirm={handleNetworkSwitch}
        title="Switch Network"
        message={`Switching to ${networkConfirmTarget} will restart all node services. This may take several minutes to sync. Any pending operations will be interrupted.`}
        description="Each network uses its own chain data directory. Your wallet and settings are preserved."
        confirmLabel="Switch Network"
        confirmVariant="default"
        loading={networkSwitching}
      />
    </>
  )
}
