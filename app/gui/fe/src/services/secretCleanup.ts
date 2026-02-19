/**
 * Secret Cleanup Service
 *
 * Securely deletes stale cryptographic secrets after confirmed ownership
 * changes on-chain. Secrets are only deleted when the transaction that
 * transferred ownership has at least MIN_CONFIRMATION_DEPTH block
 * confirmations, making chain rollback effectively impossible.
 *
 * This replaces the previous approach of deleting secrets immediately
 * after tx submission (which was vulnerable to rollbacks).
 */

import type { EncryptionDisplay } from './api';
import { chainApi } from './api';
import { listSecrets, removeSecrets } from './secretStorage';
import { hasAcceptBidSecrets, removeAcceptBidSecrets } from './acceptBidStorage';

/**
 * Minimum block confirmations before secrets are deleted.
 * 15 blocks ≈ 5 minutes on Cardano (20s block time).
 * Matches exchange-grade confirmation depth.
 */
const MIN_CONFIRMATION_DEPTH = 15;

/**
 * Cleanup stale secrets after confirmed on-chain state changes.
 *
 * Two cleanup paths:
 *
 * 1. **Ownership change** — For each stored seller secret (a, r):
 *    - If the encryption exists on-chain with a different owner
 *    - And the ownership-change tx is at least 15 blocks deep
 *    → Delete seller secrets (a, r) AND accept-bid hop secrets (a0, r0, hk)
 *
 * 2. **Cancelled pending sale** — For each stored accept-bid secret:
 *    - If we still own the encryption AND it's active (not pending)
 *    - And the cancellation tx is at least 15 blocks deep
 *    → Delete only accept-bid hop secrets (seller secrets are still needed)
 *
 * This function is best-effort and never throws — failures are logged
 * and secrets are preserved for the next cleanup cycle.
 */
export async function cleanupStaleSecrets(
  userPkh: string,
  encryptions: EncryptionDisplay[]
): Promise<void> {
  try {
    const sellerSecrets = await listSecrets();
    if (sellerSecrets.length === 0) return;

    const encryptionsByToken = new Map(
      encryptions.map((e) => [e.tokenName, e])
    );

    for (const { tokenName } of sellerSecrets) {
      const encryption = encryptionsByToken.get(tokenName);

      // If the encryption is missing from chain (burned/sync issue),
      // we do NOT auto-delete — could be a transient state.
      if (!encryption) {
        continue;
      }

      if (encryption.sellerPkh !== userPkh) {
        // Path 1: Ownership changed — verify confirmation depth
        try {
          const { confirmations } = await chainApi.getConfirmations(
            encryption.utxo.txHash
          );

          if (confirmations >= MIN_CONFIRMATION_DEPTH) {
            // Safe to delete — ownership change is deeply confirmed
            await removeSecrets(tokenName);

            // Also clean up any hop secrets from the accept-bid flow
            try {
              await removeAcceptBidSecrets(tokenName);
            } catch {
              // Accept-bid secrets may not exist, that's fine
            }

            console.log(
              `[cleanup] Securely deleted secrets for ${tokenName.slice(0, 12)}... (${confirmations} confirmations)`
            );
          }
        } catch {
          // Can't verify depth (Koios unavailable, etc.) — keep secrets
        }
      } else if (encryption.status === 'active') {
        // Path 2: We still own this encryption and it's active (not pending).
        // If accept-bid secrets exist, they're stale from a cancelled pending sale.
        try {
          const hasStaleHopSecrets = await hasAcceptBidSecrets(tokenName);
          if (!hasStaleHopSecrets) continue;

          const { confirmations } = await chainApi.getConfirmations(
            encryption.utxo.txHash
          );

          if (confirmations >= MIN_CONFIRMATION_DEPTH) {
            await removeAcceptBidSecrets(tokenName);
            console.log(
              `[cleanup] Securely deleted stale hop secrets for ${tokenName.slice(0, 12)}... (${confirmations} confirmations)`
            );
          }
        } catch {
          // Can't verify — keep secrets for next cycle
        }
      }
      // If status === 'pending', sale is in progress — never touch secrets
    }
  } catch (error) {
    // Cleanup is best-effort, never fail the main flow
    console.warn('[cleanup] Failed to cleanup stale secrets:', error);
  }
}
