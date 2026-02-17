/**
 * React hook for SNARK proof generation.
 *
 * Provides a simple interface for checking setup status and
 * generating proofs with proper React state management.
 *
 * Usage:
 *   const {
 *     isReady,
 *     isProving,
 *     progress,
 *     error,
 *     generateProof,
 *   } = useSnarkProver()
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { getSnarkProver } from '../services/snark'
import type { SnarkProofInputs, SnarkProof, ProvingProgress } from '../services/snark'

export interface UseSnarkProverResult {
  /** Whether the prover setup files exist and are ready */
  isReady: boolean
  /** Whether proof generation is in progress */
  isProving: boolean
  /** Current progress information */
  progress: ProvingProgress | null
  /** Last error message */
  error: string | null
  /** Check if setup files exist */
  checkSetup: () => Promise<boolean>
  /** Generate a SNARK proof */
  generateProof: (inputs: SnarkProofInputs) => Promise<SnarkProof | null>
  /** Clear the error state */
  clearError: () => void
}

export function useSnarkProver(): UseSnarkProverResult {
  const [isReady, setIsReady] = useState(false)
  const [isProving, setIsProving] = useState(false)
  const [progress, setProgress] = useState<ProvingProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const checkSetup = useCallback(async (): Promise<boolean> => {
    try {
      const prover = getSnarkProver()
      const exists = await prover.checkSetup()
      if (isMountedRef.current) {
        setIsReady(exists)
      }
      return exists
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check setup'
      if (isMountedRef.current) {
        setError(message)
      }
      return false
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

  // Check setup on mount
  useEffect(() => {
    checkSetup()
  }, [checkSetup])

  return {
    isReady,
    isProving,
    progress,
    error,
    checkSetup,
    generateProof,
    clearError,
  }
}
