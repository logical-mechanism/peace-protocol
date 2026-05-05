import { useEffect, useState } from 'react'

/**
 * Triggers the `.tx-celebration` class on a single state-change beat.
 *
 * Apply to the elements representing the moments that matter most in the
 * protocol: bid acceptance, decryption completion, first wallet creation.
 * One restrained beat (~600ms) is the signature motion — do not overuse.
 *
 * Usage:
 *
 *   const celebrate = useTxCelebration()
 *   const isCelebrating = useCelebrationFlag(celebrationKey)
 *   <div className={isCelebrating ? 'tx-celebration' : ''} />
 *
 * Or simpler, when the trigger is a state value that changes once:
 *
 *   const isCelebrating = useCelebrationFlag(successTxHash)
 *
 * The flag stays true for the animation duration (defaults to 600ms,
 * matching the keyframe), then resets so the class can re-trigger on a
 * subsequent state change.
 */
export function useCelebrationFlag(triggerKey: unknown, durationMs = 600): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (triggerKey === null || triggerKey === undefined || triggerKey === false || triggerKey === '') {
      return
    }
    // Intentional: triggerKey transitions are the external signal we are
    // synchronizing animation state with. Same pattern as the modal
    // two-effect rule used elsewhere in this codebase.
    /* eslint-disable react-hooks/set-state-in-effect */
    setActive(true)
    /* eslint-enable react-hooks/set-state-in-effect */
    const timer = window.setTimeout(() => setActive(false), durationMs)
    return () => window.clearTimeout(timer)
  }, [triggerKey, durationMs])

  return active
}
