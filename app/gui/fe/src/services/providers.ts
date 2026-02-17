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
import { KupoAdapter } from './kupoAdapter';

let _kupo: KupoAdapter | null = null;
let _ogmios: OgmiosProvider | null = null;

/** Local Kupo adapter — implements IFetcher for UTxO queries. */
export function getKupoAdapter(): KupoAdapter {
  if (!_kupo) {
    _kupo = new KupoAdapter('http://127.0.0.1:1442');
  }
  return _kupo;
}

/** Local Ogmios provider — implements IEvaluator + ISubmitter. */
export function getOgmiosProvider(): OgmiosProvider {
  if (!_ogmios) {
    _ogmios = new OgmiosProvider('ws://127.0.0.1:1337');
  }
  return _ogmios;
}
