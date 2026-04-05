/**
 * Auto-Accept Detection Hook
 *
 * When auto-accept is enabled, scans for eligible bids on each block change
 * and enqueues them. A bid is eligible when:
 *   - The encryption belongs to the current user (sellerPkh matches)
 *   - The encryption status is 'active'
 *   - The encryption has a suggestedPrice set
 *   - The bid is 'pending' and bid.amount >= encryption.suggestedPrice
 *
 * For each encryption, only the oldest eligible bid is enqueued (one at a time).
 * The queue service handles dedup so repeated calls are safe.
 */
import { useEffect, useRef } from 'react'
import { encryptionsApi, bidsApi } from '../services/api'
import type { EncryptionDisplay, BidDisplay } from '../services/api'

/** Minimum interval between auto-accept scans (ms). */
const SCAN_THROTTLE_MS = 30_000

interface UseAutoAcceptDetectionParams {
  userPkh: string | undefined
  autoAcceptEnabled: boolean
  tipSlot: number | null
  nodeStage: string
  enqueue: (encryption: EncryptionDisplay, bid: BidDisplay, priority: boolean) => string | null
}

export function useAutoAcceptDetection({
  userPkh,
  autoAcceptEnabled,
  tipSlot,
  nodeStage,
  enqueue,
}: UseAutoAcceptDetectionParams): void {
  const lastScanRef = useRef(0)
  const scanningRef = useRef(false)

  useEffect(() => {
    if (!autoAcceptEnabled || !userPkh || nodeStage !== 'synced' || tipSlot === null) {
      return
    }

    const now = Date.now()
    if (now - lastScanRef.current < SCAN_THROTTLE_MS) return
    if (scanningRef.current) return

    scanningRef.current = true
    lastScanRef.current = now

    ;(async () => {
      try {
        // Fetch all encryptions and bids (cache-backed — usually warm from useBidNotifications)
        const [allEncryptions, allBids] = await Promise.all([
          encryptionsApi.getAll(),
          bidsApi.getAll(),
        ])

        // Filter to user's active listings with a suggested price
        const myActiveListings = allEncryptions.filter(
          e => e.sellerPkh === userPkh && e.status === 'active' && e.suggestedPrice != null && e.suggestedPrice > 0
        )

        if (myActiveListings.length === 0) return

        // Group pending bids by encryption token
        const pendingBidsByEncryption = new Map<string, BidDisplay[]>()
        for (const bid of allBids) {
          if (bid.status !== 'pending') continue
          const existing = pendingBidsByEncryption.get(bid.encryptionToken)
          if (existing) {
            existing.push(bid)
          } else {
            pendingBidsByEncryption.set(bid.encryptionToken, [bid])
          }
        }

        // For each active listing, find the oldest eligible bid
        for (const encryption of myActiveListings) {
          const bids = pendingBidsByEncryption.get(encryption.tokenName)
          if (!bids || bids.length === 0) continue

          // Filter bids meeting the suggested price
          const eligible = bids.filter(b => b.amount >= encryption.suggestedPrice!)

          if (eligible.length === 0) continue

          // Sort by createdAt ascending (oldest first)
          eligible.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

          // Enqueue the oldest eligible bid (service handles dedup)
          enqueue(encryption, eligible[0], false)
        }
      } catch (error) {
        console.warn('[auto-accept] Scan failed:', error)
      } finally {
        scanningRef.current = false
      }
    })()
  }, [autoAcceptEnabled, userPkh, tipSlot, nodeStage, enqueue])
}
