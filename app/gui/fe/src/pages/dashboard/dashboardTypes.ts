import type { IWallet } from '@meshsdk/core'
import type { TransactionRecord } from '../../services/transactionHistory'
import type { useToast } from '../../components/Toast'

export type TabId = 'marketplace' | 'my-sales' | 'my-purchases' | 'history' | 'library';

export interface Tab {
  id: TabId;
  label: string;
}

export const TABS: Tab[] = [
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'my-sales', label: 'My Sales' },
  { id: 'my-purchases', label: 'My Purchases' },
  { id: 'history', label: 'History' },
  { id: 'library', label: 'Library' },
];

export interface ConfirmAction {
  title: string
  message: string
  description?: string
  confirmLabel: string
  onConfirm: () => Promise<void>
}

export interface DashboardActions {
  wallet: IWallet | null
  address: string | undefined
  userPkh: string | undefined
  toast: ReturnType<typeof useToast>
  recordTransaction: (record: TransactionRecord) => void
  triggerTransactionRefresh: () => void
  triggerRefresh: () => void
  setConfirmAction: (action: ConfirmAction | null) => void
  setActiveTab: (tab: TabId) => void
}
