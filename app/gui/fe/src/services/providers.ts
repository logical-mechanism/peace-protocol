/**
 * Provider Factory
 *
 * Singleton accessors for local Kupo (IFetcher) and Ogmios
 * (IEvaluator + ISubmitter) providers. Replaces the per-function
 * getBlockfrostProvider() pattern in transactionBuilder.ts.
 *
 * Ports match the Tauri-managed processes from Phase 2:
 *   - Kupo:   http://127.0.0.1:1442
 *   - Ogmios: ws://127.0.0.1:1337
 * Uses 127.0.0.1 instead of localhost to avoid IPv6 resolution issues.
 */

import { OgmiosProvider } from '@meshsdk/provider';
import type { Action } from '@meshsdk/core';
import { KupoAdapter } from './kupoAdapter';

/**
 * Wrapper around OgmiosProvider that fixes a tag mismatch in evaluateTx.
 *
 * OgmiosProvider returns withdrawal results with tag "WITHDRAW" (from
 * Ogmios's `purpose: "withdraw"`), but MeshTxBuilder.updateRedeemer
 * expects tag "REWARD". Without this fix, withdrawal script evaluation
 * results are silently dropped, leaving default (insufficient) budgets.
 */
class FixedOgmiosProvider extends OgmiosProvider {
  async evaluateTx(tx: string): Promise<Omit<Action, 'data'>[]> {
    const results = await super.evaluateTx(tx);
    return results.map((r) => ({
      ...r,
      tag: (r.tag as string) === 'WITHDRAW' ? 'REWARD' : r.tag,
    }));
  }
}

let _kupo: KupoAdapter | null = null;
let _ogmios: FixedOgmiosProvider | null = null;

/** Local Kupo adapter — implements IFetcher for UTxO queries. */
export function getKupoAdapter(): KupoAdapter {
  if (!_kupo) {
    _kupo = new KupoAdapter('http://127.0.0.1:1442');
  }
  return _kupo;
}

/** Local Ogmios provider — implements IEvaluator + ISubmitter. */
export function getOgmiosProvider(): FixedOgmiosProvider {
  if (!_ogmios) {
    _ogmios = new FixedOgmiosProvider('ws://127.0.0.1:1337');
  }
  return _ogmios;
}
