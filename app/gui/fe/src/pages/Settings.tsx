/**
 * Settings Page
 *
 * Network toggle, node status, wallet info, data directory, disk usage,
 * and process logs viewer.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useWalletContext, useAddress, useLovelace } from '../contexts/WalletContext'
import { getAutolockMinutes, setAutolockMinutes } from '../services/autolock'
import { useNode } from '../contexts/NodeContext'
import { copyToClipboard } from '../utils/clipboard'

interface DiskUsage {
  chain_data_bytes: number
  snark_data_bytes: number
  wallet_bytes: number
  total_bytes: number
  data_dir: string
}

interface ProcessLog {
  name: string
  lines: string[]
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

export default function Settings() {
  const navigate = useNavigate()
  const { walletState, lock } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { stage, syncProgress, kupoSyncProgress, tipSlot, tipHeight, network, processes } = useNode()

  // Settings state
  const [currentNetwork, setCurrentNetwork] = useState<string>('')
  const [diskUsage, setDiskUsage] = useState<DiskUsage | null>(null)
  const [showMnemonic, setShowMnemonic] = useState(false)
  const [mnemonicWords, setMnemonicWords] = useState<string[]>([])
  const [mnemonicPassword, setMnemonicPassword] = useState('')
  const [mnemonicError, setMnemonicError] = useState('')
  const [mnemonicLoading, setMnemonicLoading] = useState(false)
  const [networkSwitching, setNetworkSwitching] = useState(false)
  const [autolockValue, setAutolockValue] = useState(() => getAutolockMinutes())
  const [addressCopied, setAddressCopied] = useState(false)
  const [activeSection, setActiveSection] = useState<string>('node')

  // Process logs
  const [selectedProcess, setSelectedProcess] = useState<string>('cardano-node')
  const [processLogs, setProcessLogs] = useState<ProcessLog | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)

  // Load network and disk usage on mount
  useEffect(() => {
    invoke<string>('get_network').then(setCurrentNetwork).catch(console.error)
    invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)
  }, [])

  const handleNetworkSwitch = useCallback(async (newNetwork: string) => {
    if (newNetwork === currentNetwork) return
    if (!confirm(`Switch to ${newNetwork}? This requires restarting the node and uses a separate chain data directory.`)) return

    setNetworkSwitching(true)
    try {
      await invoke('set_network', { network: newNetwork })
      setCurrentNetwork(newNetwork)
      alert(`Network switched to ${newNetwork}. Please restart the application for changes to take effect.`)
    } catch (error) {
      console.error('Failed to switch network:', error)
      alert(`Failed to switch network: ${error}`)
    } finally {
      setNetworkSwitching(false)
    }
  }, [currentNetwork])

  const handleRevealMnemonic = useCallback(async () => {
    if (!mnemonicPassword) {
      setMnemonicError('Password required')
      return
    }
    setMnemonicLoading(true)
    setMnemonicError('')
    try {
      const words = await invoke<string[]>('reveal_mnemonic', { password: mnemonicPassword })
      setMnemonicWords(words)
      setShowMnemonic(true)
    } catch (error) {
      setMnemonicError(error instanceof Error ? error.message : String(error))
    } finally {
      setMnemonicLoading(false)
    }
  }, [mnemonicPassword])

  const handleHideMnemonic = useCallback(() => {
    setShowMnemonic(false)
    setMnemonicWords([])
    setMnemonicPassword('')
    setMnemonicError('')
  }, [])

  const handleCopyAddress = useCallback(async () => {
    if (!address) return
    const success = await copyToClipboard(address)
    if (success) {
      setAddressCopied(true)
      setTimeout(() => setAddressCopied(false), 2000)
    }
  }, [address])

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
      setProcessLogs({ name: processName, lines: [`Error: ${error}`] })
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeSection === 'logs') {
      handleFetchLogs(selectedProcess)
    }
  }, [activeSection, selectedProcess, handleFetchLogs])

  const formatAda = (lovelaceAmount: string | undefined) => {
    if (!lovelaceAmount) return '...'
    const ada = parseInt(lovelaceAmount) / 1_000_000
    return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const nodeStageLabel = (s: string) => {
    switch (s) {
      case 'synced': return 'Fully Synced'
      case 'syncing': return `Syncing (${syncProgress.toFixed(1)}%)`
      case 'starting': return 'Starting...'
      case 'bootstrapping': return 'Bootstrapping...'
      case 'stopped': return 'Stopped'
      case 'error': return 'Error'
      default: return s
    }
  }

  const stageColor = (s: string) => {
    switch (s) {
      case 'synced': return 'var(--success)'
      case 'syncing': return 'var(--warning)'
      case 'starting':
      case 'bootstrapping': return 'var(--accent)'
      case 'error': return 'var(--error)'
      default: return 'var(--text-muted)'
    }
  }

  const processStatusColor = (status: { type: string }) => {
    switch (status.type) {
      case 'Running':
      case 'Ready': return 'var(--success)'
      case 'Starting':
      case 'Syncing': return 'var(--warning)'
      case 'Error': return 'var(--error)'
      default: return 'var(--text-muted)'
    }
  }

  const sections = [
    { id: 'node', label: 'Node Status' },
    { id: 'wallet', label: 'Wallet' },
    { id: 'network', label: 'Network' },
    { id: 'storage', label: 'Storage' },
    { id: 'logs', label: 'Logs' },
  ]

  return (
    <div className="min-h-screen">
      {/* Header */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Section Tabs */}
        <div className="border-b border-[var(--border-subtle)] mb-8">
          <div className="flex gap-6">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`pb-3 transition-all duration-150 cursor-pointer ${
                  activeSection === s.id
                    ? 'text-[var(--text-primary)] border-b-2 border-[var(--accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Node Status Section */}
        {activeSection === 'node' && (
          <div className="space-y-6">
            {/* Overall Status */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Node Infrastructure</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Status</span>
                  <p className="text-lg font-medium flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: stageColor(stage) }}
                    />
                    {nodeStageLabel(stage)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Network</span>
                  <p className="text-lg font-medium capitalize">{network || currentNetwork || '...'}</p>
                </div>
                {tipSlot !== null && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Tip Slot</span>
                    <p className="text-lg font-mono">{tipSlot?.toLocaleString()}</p>
                  </div>
                )}
                {tipHeight !== null && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Tip Height</span>
                    <p className="text-lg font-mono">{tipHeight?.toLocaleString()}</p>
                  </div>
                )}
              </div>

              {stage === 'syncing' && (
                <div className="mt-4 space-y-3">
                  <div>
                    <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                      <span>Node Sync</span>
                      <span>{syncProgress >= 99.9 ? 'Synced' : `${syncProgress.toFixed(1)}%`}</span>
                    </div>
                    <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
                        style={{ width: `${Math.min(syncProgress, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm text-[var(--text-muted)] mb-1">
                      <span>Kupo Indexer</span>
                      <span>{kupoSyncProgress >= 99.9 ? 'Synced' : `${kupoSyncProgress.toFixed(1)}%`}</span>
                    </div>
                    <div className="w-full h-3 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-[var(--accent)] to-[var(--success)] transition-all duration-300"
                        style={{ width: `${Math.min(kupoSyncProgress, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Process List */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Processes</h2>
              <div className="space-y-3">
                {processes.length === 0 ? (
                  <p className="text-[var(--text-muted)]">No processes registered</p>
                ) : (
                  processes.map((proc) => (
                    <div
                      key={proc.name}
                      className="flex items-center justify-between py-2 border-b border-[var(--border-subtle)] last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: processStatusColor(proc.status as unknown as { type: string }) }}
                        />
                        <span className="font-mono text-sm">{proc.name}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        {proc.pid && (
                          <span className="text-xs text-[var(--text-muted)] font-mono">PID {proc.pid}</span>
                        )}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                          {(proc.status as unknown as { type: string }).type}
                        </span>
                        {proc.restart_count > 0 && (
                          <span className="text-xs text-[var(--warning)]">
                            {proc.restart_count} restart{proc.restart_count > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Wallet Section */}
        {activeSection === 'wallet' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Wallet Info</h2>
              <div className="space-y-4">
                <div>
                  <span className="text-sm text-[var(--text-muted)]">Status</span>
                  <p className="text-lg font-medium capitalize">{walletState}</p>
                </div>
                {address && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Address</span>
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-sm font-mono bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all flex-1">
                        {address}
                      </code>
                      <button
                        onClick={handleCopyAddress}
                        className="px-3 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer shrink-0"
                      >
                        {addressCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
                {lovelace && (
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Balance</span>
                    <p className="text-lg font-medium text-[var(--accent)]">{formatAda(lovelace)} ADA</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recovery Phrase */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Recovery Phrase</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                View your 24-word recovery phrase. You will need to re-enter your password.
              </p>

              {!showMnemonic ? (
                <div className="space-y-3">
                  <input
                    type="password"
                    value={mnemonicPassword}
                    onChange={(e) => setMnemonicPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleRevealMnemonic()}
                    placeholder="Enter wallet password"
                    className="w-full px-4 py-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  {mnemonicError && (
                    <p className="text-sm text-[var(--error)]">{mnemonicError}</p>
                  )}
                  <button
                    onClick={handleRevealMnemonic}
                    disabled={mnemonicLoading || !mnemonicPassword}
                    className="px-4 py-2 text-sm bg-[var(--warning)] text-black rounded-[var(--radius-md)] hover:bg-[var(--warning)]/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {mnemonicLoading ? 'Verifying...' : 'Reveal Recovery Phrase'}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-2 p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)] border border-[var(--warning)]/30">
                    {mnemonicWords.map((word, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <span className="text-xs text-[var(--text-muted)] w-5 text-right">{i + 1}.</span>
                        <span className="text-sm font-mono">{word}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleHideMnemonic}
                    className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                  >
                    Hide Recovery Phrase
                  </button>
                </div>
              )}
            </div>

            {/* Auto-Lock */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Auto-Lock</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Automatically lock the wallet after a period of inactivity.
              </p>
              <select
                value={autolockValue}
                onChange={(e) => {
                  const mins = Number(e.target.value)
                  setAutolockValue(mins)
                  setAutolockMinutes(mins)
                }}
                className="px-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={0}>Never</option>
              </select>
            </div>

            {/* Lock Wallet */}
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-2">Lock Wallet</h2>
              <p className="text-sm text-[var(--text-muted)] mb-4">
                Lock your wallet to require password entry before using it again.
              </p>
              <button
                onClick={() => { lock(); navigate('/') }}
                className="px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
              >
                Lock Wallet
              </button>
            </div>
          </div>
        )}

        {/* Network Section */}
        {activeSection === 'network' && (
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
                    onClick={() => handleNetworkSwitch(net)}
                    disabled={networkSwitching}
                    className={`p-4 rounded-[var(--radius-lg)] border-2 transition-all cursor-pointer ${
                      currentNetwork === net
                        ? 'border-[var(--accent)] bg-[var(--accent-muted)]'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:bg-[var(--bg-card-hover)]'
                    } ${networkSwitching ? 'opacity-50 cursor-not-allowed' : ''}`}
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
            </div>
          </div>
        )}

        {/* Storage Section */}
        {activeSection === 'storage' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <h2 className="text-lg font-medium mb-4">Disk Usage</h2>

              {diskUsage ? (
                <div className="space-y-4">
                  <div>
                    <span className="text-sm text-[var(--text-muted)]">Data Directory</span>
                    <code className="block text-sm font-mono mt-1 bg-[var(--bg-secondary)] px-3 py-2 rounded-[var(--radius-md)] break-all">
                      {diskUsage.data_dir}
                    </code>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">Chain Data</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.chain_data_bytes)}</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">SNARK Setup</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.snark_data_bytes)}</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">Wallet</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.wallet_bytes)}</p>
                    </div>
                    <div className="p-4 bg-[var(--bg-secondary)] rounded-[var(--radius-md)]">
                      <span className="text-sm text-[var(--text-muted)]">Total</span>
                      <p className="text-xl font-medium mt-1">{formatBytes(diskUsage.total_bytes)}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => invoke<DiskUsage>('get_disk_usage').then(setDiskUsage).catch(console.error)}
                    className="mt-2 px-4 py-2 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>
              ) : (
                <p className="text-[var(--text-muted)]">Loading...</p>
              )}
            </div>
          </div>
        )}

        {/* Logs Section */}
        {activeSection === 'logs' && (
          <div className="space-y-6">
            <div className="bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">Process Logs</h2>
                <button
                  onClick={() => handleFetchLogs(selectedProcess)}
                  disabled={logsLoading}
                  className="px-3 py-1.5 text-sm border border-[var(--border-subtle)] rounded-[var(--radius-md)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {logsLoading ? 'Loading...' : 'Refresh'}
                </button>
              </div>

              {/* Process Selector */}
              <div className="flex gap-2 mb-4">
                {['cardano-node', 'ogmios', 'kupo', 'express', 'mithril-client'].map((name) => (
                  <button
                    key={name}
                    onClick={() => setSelectedProcess(name)}
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

              {/* Log Output */}
              <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] p-4 font-mono text-xs max-h-96 overflow-y-auto">
                {processLogs?.lines.length ? (
                  processLogs.lines.map((line, i) => (
                    <div
                      key={i}
                      className={`py-0.5 break-all ${
                        line.startsWith('[stderr]')
                          ? 'text-[var(--warning)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {line}
                    </div>
                  ))
                ) : (
                  <p className="text-[var(--text-muted)]">
                    {logsLoading ? 'Loading logs...' : 'No logs available'}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
