/**
 * Wallet Health Hook
 *
 * Monitors the wallet UTxO set and exposes health indicators:
 * collateral presence, fragmentation level, UTxO counts.
 *
 * Triggers on new blocks (tipSlot changes) when node is synced.
 * Throttled to 30s between checks; recheck() bypasses throttle.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { IWallet, UTxO } from '@meshsdk/core'
import { analyzeUtxoSet, type UtxoAnalysis } from '../services/walletManagement'

export interface WalletHealthState {
  hasCollateral: boolean
  utxoCount: number
  pureAdaCount: number
  tokenUtxoCount: number
  distinctAssetCount: number
  isFragmented: boolean
  needsDefrag: boolean
  isChecking: boolean
  utxos: UTxO[]
  recheck: () => void
}

const THROTTLE_MS = 30_000

const DEFAULTS: Omit<WalletHealthState, 'recheck'> = {
  hasCollateral: false,
  utxoCount: 0,
  pureAdaCount: 0,
  tokenUtxoCount: 0,
  distinctAssetCount: 0,
  isFragmented: false,
  needsDefrag: false,
  isChecking: false,
  utxos: [],
}

export function useWalletHealth(
  wallet: IWallet | null,
  tipSlot: number | null,
  nodeStage: string,
): WalletHealthState {
  const [state, setState] = useState<Omit<WalletHealthState, 'recheck'>>(DEFAULTS)
  const lastCheckRef = useRef<number>(0)
  const forceRecheckRef = useRef<boolean>(false)

  const performCheck = useCallback(async () => {
    if (!wallet) return

    setState((prev) => ({ ...prev, isChecking: true }))
    try {
      const utxos = await wallet.getUtxos()
      const analysis: UtxoAnalysis = analyzeUtxoSet(utxos)

      setState({
        hasCollateral: analysis.hasCollateral,
        utxoCount: analysis.utxoCount,
        pureAdaCount: analysis.pureAdaCount,
        tokenUtxoCount: analysis.tokenUtxoCount,
        distinctAssetCount: analysis.distinctAssetCount,
        isFragmented: analysis.isFragmented,
        needsDefrag: analysis.isFragmented,
        isChecking: false,
        utxos,
      })
      lastCheckRef.current = Date.now()
    } catch {
      // Kupo may not be ready — preserve last known state
      setState((prev) => ({ ...prev, isChecking: false }))
    }
  }, [wallet])

  // Trigger on tipSlot changes when synced (throttled)
  useEffect(() => {
    if (!wallet || nodeStage !== 'synced' || tipSlot === null) return

    const elapsed = Date.now() - lastCheckRef.current
    if (elapsed < THROTTLE_MS && !forceRecheckRef.current) return

    forceRecheckRef.current = false
    const id = setTimeout(performCheck, 0)
    return () => clearTimeout(id)
  }, [wallet, nodeStage, tipSlot, performCheck])

  // Manual recheck (bypasses throttle)
  const recheck = useCallback(() => {
    forceRecheckRef.current = true
    performCheck()
  }, [performCheck])

  return { ...state, recheck }
}
