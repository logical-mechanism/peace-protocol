/**
 * Accept-Bid Queue Service
 *
 * A headless singleton that manages sequential processing of bid acceptances.
 * Each item goes through: validate → prepare SNARK inputs → prove → submit txs.
 * Only one item processes at a time (~3 min per SNARK proof).
 *
 * Framework-agnostic (no React imports). React subscribes via the event emitter.
 */

import type { IWallet } from '@meshsdk/core'
import type { EncryptionDisplay, BidDisplay } from './api'
import { encryptionsApi, bidsApi } from './api'
import { prepareSnarkInputs, acceptBidAndReEncrypt } from './transactions/acceptBid'
import type { ChainedAcceptStep } from './transactions/txUtils'
import { getSnarkProver } from './snark'
import { optimisticStore } from './optimisticStore'
import { formatAda } from '../utils/formatAda'
import {
  getAutoAcceptEnabled, setAutoAcceptEnabled as persistAutoAccept,
  setPersistedQueue, type SerializedQueueItem,
} from './acceptBidQueueStorage'
import { addTransaction } from './transactionHistory'
import i18n from '../i18n'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueueItemStatus = 'queued' | 'preparing' | 'proving' | 'submitting' | 'complete' | 'failed'

export interface QueueItem {
  id: string
  encryption: EncryptionDisplay
  bid: BidDisplay
  status: QueueItemStatus
  /** Manual selections get priority (inserted at front of queue). */
  priority: boolean
  error?: string
  /** Set when Phase 12e succeeded but Phase 12f failed. */
  partialSuccess?: 'snark-only'
  addedAt: number
  startedAt?: number
  completedAt?: number
  /** Elapsed milliseconds for the proving step. */
  provingElapsed?: number
  /** Tx hashes for completed or partial items. */
  snarkTxHash?: string
  reEncryptTxHash?: string
}

export type QueueEvent = 'change' | 'item-complete' | 'item-failed'
type Listener = (item?: QueueItem) => void

export interface ToastHandle {
  info: (title: string, message?: string, duration?: number) => void
  success: (title: string, message?: string, duration?: number) => void
  warning: (title: string, message?: string, duration?: number) => void
  error: (title: string, message?: string, duration?: number) => void
}

/** Minimal deps for queue processing. Only wallet is required. */
export interface ProcessingDeps {
  wallet: IWallet
  /** Wallet payment key hash — needed for transaction recording. */
  userPkh: string
  /** Optional toast handle — when Dashboard is not mounted, falls back to console. */
  toast?: ToastHandle | null
  /** Optional refresh trigger — fires escalating cache clears when Dashboard is mounted. */
  triggerTransactionRefresh?: (() => void) | null
}

/** Fallback toast that logs to console when no UI toast is available. */
const consoleToast: ToastHandle = {
  info: (title, msg) => console.log(`[queue] ${title}${msg ? ': ' + msg : ''}`),
  success: (title, msg) => console.log(`[queue] ${title}${msg ? ': ' + msg : ''}`),
  warning: (title, msg) => console.warn(`[queue] ${title}${msg ? ': ' + msg : ''}`),
  error: (title, msg) => console.error(`[queue] ${title}${msg ? ': ' + msg : ''}`),
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AcceptBidQueueService {
  private queue: QueueItem[] = []
  private processing = false
  private stopRequested = false
  private deps: ProcessingDeps | null = null
  private autoAcceptEnabled: boolean
  private encryptionTokensInQueue = new Set<string>()
  private listeners = new Map<QueueEvent, Set<Listener>>()

  constructor() {
    this.autoAcceptEnabled = getAutoAcceptEnabled()
    this.loadPersistedQueue()
  }

  // -------------------------------------------------------------------------
  // Event emitter
  // -------------------------------------------------------------------------

  on(event: QueueEvent, listener: Listener): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(listener)
  }

  off(event: QueueEvent, listener: Listener): void {
    this.listeners.get(event)?.delete(listener)
  }

  private emit(event: QueueEvent, item?: QueueItem): void {
    this.listeners.get(event)?.forEach(fn => fn(item))
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Add an item to the queue. Returns the item id, or null if the encryption is already queued. */
  enqueue(encryption: EncryptionDisplay, bid: BidDisplay, priority: boolean): string | null {
    if (this.encryptionTokensInQueue.has(encryption.tokenName)) {
      return null
    }

    const id = crypto.randomUUID()
    const item: QueueItem = {
      id,
      encryption,
      bid,
      status: 'queued',
      priority,
      addedAt: Date.now(),
    }

    this.encryptionTokensInQueue.add(encryption.tokenName)

    if (priority) {
      // Insert after any currently-processing item (index 0 if processing, else at 0)
      const insertAt = this.queue.length > 0 && this.queue[0].status !== 'queued' ? 1 : 0
      this.queue.splice(insertAt, 0, item)
    } else {
      this.queue.push(item)
    }

    this.persistQueue()
    this.emit('change')

    // Auto-start if deps are available and not already processing
    if (this.deps && !this.processing) {
      this.processLoop()
    }

    return id
  }

  /** Remove a queued (not currently processing) item. */
  remove(itemId: string): boolean {
    const idx = this.queue.findIndex(i => i.id === itemId)
    if (idx === -1) return false
    const item = this.queue[idx]
    // Don't remove items that are currently being processed
    if (item.status === 'preparing' || item.status === 'proving' || item.status === 'submitting') {
      return false
    }
    this.queue.splice(idx, 1)
    this.encryptionTokensInQueue.delete(item.encryption.tokenName)
    this.persistQueue()
    this.emit('change')
    return true
  }

  /** Reset a failed item to queued and move it to the front. */
  retry(itemId: string): boolean {
    const item = this.queue.find(i => i.id === itemId)
    if (!item || item.status !== 'failed') return false

    item.status = 'queued'
    item.error = undefined
    item.partialSuccess = undefined
    item.startedAt = undefined
    item.completedAt = undefined
    item.provingElapsed = undefined
    item.snarkTxHash = undefined
    item.reEncryptTxHash = undefined

    // Move to front (after any currently-processing item)
    const idx = this.queue.indexOf(item)
    this.queue.splice(idx, 1)
    const insertAt = this.queue.length > 0 && this.queue[0].status !== 'queued' ? 1 : 0
    this.queue.splice(insertAt, 0, item)

    this.persistQueue()
    this.emit('change')

    // Auto-start if deps are available and not already processing
    if (this.deps && !this.processing) {
      this.processLoop()
    }

    return true
  }

  /** Remove all non-processing items (queued + failed + complete). */
  clear(): void {
    this.queue = this.queue.filter(i =>
      i.status === 'preparing' || i.status === 'proving' || i.status === 'submitting'
    )
    this.encryptionTokensInQueue.clear()
    for (const item of this.queue) {
      this.encryptionTokensInQueue.add(item.encryption.tokenName)
    }
    this.persistQueue()
    this.emit('change')
  }

  getQueue(): QueueItem[] {
    return [...this.queue]
  }

  getCurrentItem(): QueueItem | null {
    const item = this.queue.find(i =>
      i.status === 'preparing' || i.status === 'proving' || i.status === 'submitting'
    )
    return item ?? null
  }

  isProcessing(): boolean {
    return this.processing
  }

  getAutoAcceptEnabled(): boolean {
    return this.autoAcceptEnabled
  }

  setAutoAccept(enabled: boolean): void {
    this.autoAcceptEnabled = enabled
    persistAutoAccept(enabled)
    this.emit('change')
  }

  /** Provide dependencies and begin processing queued items. */
  startProcessing(deps: ProcessingDeps): void {
    this.deps = deps
    this.stopRequested = false
    if (!this.processing && this.nextQueuedItem()) {
      this.processLoop()
    }
  }

  /** Signal the processing loop to stop after the current item finishes. */
  stopProcessing(): void {
    this.stopRequested = true
    this.deps = null
  }

  /** Check if there's an encryption token already in the queue. */
  hasEncryptionInQueue(tokenName: string): boolean {
    return this.encryptionTokensInQueue.has(tokenName)
  }

  // -------------------------------------------------------------------------
  // Processing loop
  // -------------------------------------------------------------------------

  private nextQueuedItem(): QueueItem | undefined {
    return this.queue.find(i => i.status === 'queued')
  }

  private async processLoop(): Promise<void> {
    if (this.processing) return
    this.processing = true
    this.emit('change')

    let item: QueueItem | undefined
    while ((item = this.nextQueuedItem()) && !this.stopRequested && this.deps) {
      await this.processItem(item, this.deps)
    }

    this.processing = false
    this.emit('change')
  }

  private async processItem(item: QueueItem, deps: ProcessingDeps): Promise<void> {
    const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'notifications', ...opts })
    const label = item.encryption.description
      ? item.encryption.description.slice(0, 30)
      : item.encryption.tokenName.slice(0, 16) + '...'
    const bidAda = formatAda(item.bid.amount)
    const toast = deps.toast ?? consoleToast

    try {
      // Step 0: Validate — re-fetch to confirm encryption is still active and bid still pending
      item.status = 'preparing'
      item.startedAt = Date.now()
      this.persistQueue()
      this.emit('change')

      const [freshEncryption, freshBids] = await Promise.all([
        encryptionsApi.getByToken(item.encryption.tokenName).catch(() => null),
        bidsApi.getByEncryption(item.encryption.tokenName).catch(() => []),
      ])

      if (!freshEncryption || freshEncryption.status !== 'active') {
        throw new Error(`Listing "${label}" is no longer active`)
      }

      const freshBid = freshBids.find(b => b.tokenName === item.bid.tokenName && b.status === 'pending')
      if (!freshBid) {
        throw new Error(`Bid of ${bidAda} ADA is no longer pending`)
      }

      // Use fresh data for the transaction
      item.encryption = freshEncryption
      item.bid = freshBid

      // Step 1: Prepare SNARK inputs
      toast.info(t('toast.queue.preparingTitle'), t('toast.queue.preparingBody', { label }))
      const { inputs, a0, r0, hk } = await prepareSnarkInputs(item.bid)

      // Step 2: Generate proof
      item.status = 'proving'
      this.persistQueue()
      this.emit('change')

      toast.info(t('toast.queue.provingTitle'), t('toast.queue.provingBody', { label }))
      const provingStart = Date.now()
      const prover = getSnarkProver()
      const proof = await prover.generateProof(inputs)
      item.provingElapsed = Date.now() - provingStart

      // Step 3: Submit transactions (12e + 12f chained)
      item.status = 'submitting'
      this.persistQueue()
      this.emit('change')

      const amount = formatAda(item.bid.amount)
      const result = await acceptBidAndReEncrypt(
        deps.wallet,
        item.encryption,
        item.bid,
        proof,
        a0, r0, hk,
        (step: ChainedAcceptStep) => {
          if (step === 'submitting-snark') toast.info(t('toast.queue.step1Title'), t('toast.queue.step1SubmittingBody', { label }))
          else if (step === 'building-reencrypt') toast.info(t('toast.queue.step2Title'), t('toast.queue.step2BuildingBody', { label }))
          else if (step === 'submitting-reencrypt') toast.info(t('toast.queue.step2Title'), t('toast.queue.step2SubmittingBody', { label }))
          else if (step === 'complete') toast.success(t('toast.queue.completeTitle'), t('toast.queue.completeBody', { label }))
          else if (step === 'fallback') toast.warning(t('toast.queue.partialTitle'), t('toast.queue.partialBody', { label }))
        },
        // onSnarkSubmitted — record directly to localStorage (works even if Dashboard is unmounted)
        (txHash) => {
          item.snarkTxHash = txHash
          addTransaction(deps.userPkh, {
            txHash,
            type: 'accept-bid',
            tokenName: item.encryption.tokenName,
            timestamp: Date.now(),
            status: 'pending',
            description: `Accept bid SNARK proof of ${amount} ADA (Step 1/2) [auto-queue]`,
            amountLovelace: item.bid.amount,
            counterparty: item.bid.bidderPkh,
          })
        },
        // onReEncryptSubmitted
        (txHash) => {
          item.reEncryptTxHash = txHash
          addTransaction(deps.userPkh, {
            txHash,
            type: 'accept-bid',
            tokenName: item.encryption.tokenName,
            timestamp: Date.now(),
            status: 'pending',
            description: `Complete re-encryption of ${amount} ADA (Step 2/2) [auto-queue]`,
            amountLovelace: item.bid.amount,
            counterparty: item.bid.bidderPkh,
          })
        },
      )

      if (!result.success) {
        throw new Error(result.error || 'Transaction submission failed')
      }

      // Check for partial success (12e ok, 12f failed)
      if (result.error && result.snarkTxHash) {
        item.status = 'failed'
        item.error = 'SNARK proof submitted but re-encryption failed. Complete manually from My Sales.'
        item.partialSuccess = 'snark-only'
        item.completedAt = Date.now()
        this.persistQueue()
        this.emit('item-failed', item)
        this.emit('change')
        return
      }

      // Optimistic update
      if (result.txHash || result.snarkTxHash) {
        optimisticStore.updateEncryption(
          item.encryption.tokenName,
          result.txHash || result.snarkTxHash!,
          { status: 'pending' }
        )
      }

      // Success
      item.status = 'complete'
      item.completedAt = Date.now()
      this.persistQueue()
      deps.triggerTransactionRefresh?.()
      this.emit('item-complete', item)
      this.emit('change')

    } catch (error) {
      console.error(`[queue] Failed to process "${label}":`, error)
      item.status = 'failed'
      item.error = error instanceof Error ? error.message : 'Unknown error'
      item.completedAt = Date.now()
      this.persistQueue()
      toast.error(t('toast.queue.failedTitle'), t('toast.queue.failedBody', { label, error: item.error }))
      this.emit('item-failed', item)
      this.emit('change')
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private persistQueue(): void {
    const serialized: SerializedQueueItem[] = this.queue.map(item => ({
      id: item.id,
      encryptionTokenName: item.encryption.tokenName,
      bidTokenName: item.bid.tokenName,
      status: item.status,
      priority: item.priority,
      error: item.error,
      partialSuccess: item.partialSuccess,
      addedAt: item.addedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      provingElapsed: item.provingElapsed,
    }))
    setPersistedQueue(serialized)
  }

  private loadPersistedQueue(): void {
    // Clear stale persisted data on startup. We can't restore full QueueItem objects
    // because encryption/bid display data isn't persisted. Auto-accept will re-detect
    // eligible bids, and users can manually re-accept from the UI.
    setPersistedQueue([])
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AcceptBidQueueService | null = null

export function getAcceptBidQueueService(): AcceptBidQueueService {
  if (!instance) {
    instance = new AcceptBidQueueService()
  }
  return instance
}

/** Reset the singleton (for testing). */
export function resetAcceptBidQueueService(): void {
  if (instance) {
    instance.stopProcessing()
    instance.clear()
  }
  instance = null
}
