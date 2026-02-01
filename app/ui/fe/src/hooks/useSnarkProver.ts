/**
 * React hook for SNARK proof generation.
 *
 * Provides a simple interface for checking cache status, downloading files,
 * and generating proofs with proper React state management.
 *
 * Usage:
 *   const {
 *     isReady,
 *     isCached,
 *     isProving,
 *     progress,
 *     error,
 *     checkCache,
 *     downloadFiles,
 *     generateProof,
 *   } = useSnarkProver()
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { getSnarkProver } from '../services/snark'
import type { SnarkProofInputs, SnarkProof, ProvingProgress } from '../services/snark'

export interface UseSnarkProverResult {
  /** Whether the prover is fully initialized and ready */
  isReady: boolean
  /** Whether SNARK files are cached in IndexedDB */
  isCached: boolean | null
  /** Whether proof generation is in progress */
  isProving: boolean
  /** Whether files are being downloaded */
  isDownloading: boolean
  /** Current progress information */
  progress: ProvingProgress | null
  /** Last error message */
  error: string | null
  /** Check if files are cached */
  checkCache: () => Promise<boolean>
  /** Download and cache SNARK files */
  downloadFiles: () => Promise<void>
  /** Generate a SNARK proof */
  generateProof: (inputs: SnarkProofInputs) => Promise<SnarkProof | null>
  /** Clear the error state */
  clearError: () => void
  /** Clear cached files */
  clearCache: () => Promise<void>
}

export function useSnarkProver(): UseSnarkProverResult {
  const [isReady, setIsReady] = useState(false)
  const [isCached, setIsCached] = useState<boolean | null>(null)
  const [isProving, setIsProving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [progress, setProgress] = useState<ProvingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep track of mounted state to avoid state updates after unmount
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkCache = useCallback(async (): Promise<boolean> => {
    try {
      const prover = getSnarkProver()
      const { cached } = await prover.checkCache()
      if (isMountedRef.current) {
        setIsCached(cached)
      }
      return cached
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check cache'
      if (isMountedRef.current) {
        setError(message)
      }
      return false
    }
  }, [])

  const downloadFiles = useCallback(async (): Promise<void> => {
    if (isMountedRef.current) {
      setIsDownloading(true)
      setError(null)
      setProgress(null)
    }

    try {
      const prover = getSnarkProver()
      await prover.ensureFilesDownloaded((prog) => {
        if (isMountedRef.current) {
          setProgress(prog)
        }
      })
      if (isMountedRef.current) {
        setIsCached(true)
        setIsReady(true)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Download failed'
      if (isMountedRef.current) {
        setError(message)
      }
      throw err
    } finally {
      if (isMountedRef.current) {
        setIsDownloading(false)
      }
    }
  }, [])

  const generateProof = useCallback(async (inputs: SnarkProofInputs): Promise<SnarkProof | null> => {
    if (isMountedRef.current) {
      setIsProving(true)
      setError(null)
      setProgress(null)
    }

    try {
      const prover = getSnarkProver()
      const proof = await prover.generateProof(inputs, (prog) => {
        if (isMountedRef.current) {
          setProgress(prog)
        }
      })
      return proof
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Proof generation failed'
      if (isMountedRef.current) {
        setError(message)
      }
      return null
    } finally {
      if (isMountedRef.current) {
        setIsProving(false)
      }
    }
  }, [])

  const clearError = useCallback(() => {
    if (isMountedRef.current) {
      setError(null)
    }
  }, [])

  const clearCache = useCallback(async (): Promise<void> => {
    try {
      const prover = getSnarkProver()
      await prover.clearCache()
      if (isMountedRef.current) {
        setIsCached(false)
        setIsReady(false)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear cache'
      if (isMountedRef.current) {
        setError(message)
      }
    }
  }, [])

  // Check cache on mount
  useEffect(() => {
    checkCache().then((cached) => {
      if (cached && isMountedRef.current) {
        setIsReady(true)
      }
    })
  }, [checkCache])

  return {
    isReady,
    isCached,
    isProving,
    isDownloading,
    progress,
    error,
    checkCache,
    downloadFiles,
    generateProof,
    clearError,
    clearCache,
  }
}
