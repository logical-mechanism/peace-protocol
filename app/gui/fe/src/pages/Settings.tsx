/**
 * Settings Page
 *
 * Network toggle, node status, wallet info, data directory, disk usage,
 * and process logs viewer.
 */

import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useWalletContext, useAddress, useLovelace } from '../contexts/WalletContext'
import { useNode } from '../contexts/NodeContext'
import { extractPaymentKeyHash } from '../services/transactionBuilder'
import { useToast, ToastContainer } from '../components/Toast'
import { searchableSections } from './settings/settingsSearch'
import NodeSection from './settings/NodeSection'
import WalletSection from './settings/WalletSection'
import NetworkSection from './settings/NetworkSection'
import DataLayerSection from './settings/DataLayerSection'
import StorageSection from './settings/StorageSection'
import LogsSection from './settings/LogsSection'
import UpdateSection from './settings/UpdateSection'
import AutomationSection from './settings/AutomationSection'

export default function Settings() {
  const navigate = useNavigate()
  const { walletState, lock, wallet } = useWalletContext()
  const address = useAddress()
  const lovelace = useLovelace()
  const { stage, syncProgress, kupoSyncProgress, tipSlot, tipHeight, network, processes, stopNode } = useNode()

  // Settings state
  const [currentNetwork, setCurrentNetwork] = useState<string>('')
  const location = useLocation()
  const [activeSection, setActiveSection] = useState<string>(
    (location.state as { section?: string })?.section || 'node'
  )

  // Settings search
  const [searchQuery, setSearchQuery] = useState('')

  const toast = useToast()

  // Derived user PKH for transaction history operations
  const userPkh = useMemo(() => {
    if (!address) return undefined
    try { return extractPaymentKeyHash(address) } catch { return undefined }
  }, [address])

  // Load network on mount
  useEffect(() => {
    invoke<string>('get_network').then(setCurrentNetwork).catch(console.error)
  }, [])

  const sectionGroups = [
    { label: 'Node & Network', sections: [
      { id: 'node', label: 'Node Status', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
      )},
      { id: 'network', label: 'Network', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9 9 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      )},
      { id: 'logs', label: 'Logs', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      )},
    ]},
    { label: 'Wallet & Security', sections: [
      { id: 'wallet', label: 'Wallet', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 110-6h5.25A2.25 2.25 0 0121 6v6zm0 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18V6a2.25 2.25 0 012.25-2.25h13.5" />
        </svg>
      )},
      { id: 'automation', label: 'Automation', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077l1.41-.513m14.095-5.13l1.41-.513M5.106 17.785l1.15-.964m11.49-9.642l1.149-.964M7.501 19.795l.75-1.3m7.5-12.99l.75-1.3m-6.063 16.658l.26-1.477m2.605-14.772l.26-1.477m0 17.726l-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205L12 12" />
        </svg>
      )},
    ]},
    { label: 'Storage & Data', sections: [
      { id: 'datalayer', label: 'Data Layer', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      )},
      { id: 'storage', label: 'Storage', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
        </svg>
      )},
    ]},
    { label: 'About', sections: [
      { id: 'update', label: 'Updates', icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
        </svg>
      )},
    ]},
  ]

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.toLowerCase()
    return searchableSections.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.keywords.some(k => k.includes(q))
    )
  }, [searchQuery])

  return (
    <div className="min-h-screen">
      {/* Header */}
      <nav className="h-16 border-b border-[var(--border-subtle)] px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 btn-base btn-icon"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search settings..."
          className="px-3 py-1.5 text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] w-48"
          aria-label="Search settings"
        />
      </nav>

      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-[var(--border-subtle)] px-3 py-6 sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
          <nav>
            {sectionGroups.map((group, groupIndex) => (
              <div key={group.label} className={groupIndex > 0 ? 'mt-6' : ''}>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2 px-3">
                  {group.label}
                </h3>
                <div className="space-y-1">
                  {group.sections.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setActiveSection(s.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer ${
                        activeSection === s.id
                          ? 'bg-[var(--accent-muted)] text-[var(--text-primary)] border-l-2 border-[var(--accent)] ml-[-1px]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card-hover)]'
                      }`}
                    >
                      {s.icon}
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main id="main-content" className="flex-1 max-w-4xl px-8 py-8">

        {/* Search Results */}
        {searchResults && (
          <div className="mb-8 space-y-2">
            <p className="text-sm text-[var(--text-muted)] mb-3">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
            </p>
            {searchResults.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">No matching settings found.</p>
            ) : (
              searchResults.map(s => (
                <button
                  key={`${s.tab}-${s.title}`}
                  onClick={() => { setActiveSection(s.tab); setSearchQuery('') }}
                  className="block w-full text-left px-4 py-3 bg-[var(--bg-card)] rounded-[var(--radius-md)] btn-base btn-tertiary"
                >
                  <span className="text-sm font-medium">{s.title}</span>
                  <span className="text-xs text-[var(--text-muted)] ml-2">
                    in {sectionGroups.flatMap(g => g.sections).find(sec => sec.id === s.tab)?.label}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Node Status Section */}
        {!searchResults && activeSection === 'node' && (
          <NodeSection
            stage={stage}
            syncProgress={syncProgress}
            kupoSyncProgress={kupoSyncProgress}
            tipSlot={tipSlot}
            tipHeight={tipHeight}
            network={network}
            currentNetwork={currentNetwork}
            processes={processes}
          />
        )}

        {/* Wallet Section */}
        {!searchResults && activeSection === 'wallet' && (
          <WalletSection
            walletState={walletState}
            wallet={wallet}
            address={address}
            lovelace={lovelace ?? null}
            userPkh={userPkh}
            stage={stage}
            tipSlot={tipSlot}
            lock={lock}
          />
        )}

        {/* Network Section */}
        {!searchResults && activeSection === 'network' && (
          <NetworkSection
            currentNetwork={currentNetwork}
            stage={stage}
            stopNode={stopNode}
            setCurrentNetwork={setCurrentNetwork}
          />
        )}

        {/* Data Layer Section */}
        {!searchResults && activeSection === 'datalayer' && (
          <DataLayerSection
            wallet={wallet}
            address={address}
            walletState={walletState}
          />
        )}

        {/* Storage Section */}
        {!searchResults && activeSection === 'storage' && (
          <StorageSection
            userPkh={userPkh}
          />
        )}

        {/* Logs Section */}
        {!searchResults && activeSection === 'logs' && (
          <LogsSection
            processes={processes}
          />
        )}

        {/* Automation Section */}
        {!searchResults && activeSection === 'automation' && (
          <AutomationSection />
        )}

        {/* Updates Section */}
        {!searchResults && activeSection === 'update' && (
          <UpdateSection />
        )}

      </main>
      </div>

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} queuedCount={toast.queuedCount} onDismissAll={toast.dismissAll} />
    </div>
  )
}
