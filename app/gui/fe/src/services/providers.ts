/**
 * Provider Factory
 *
 * Singleton accessors for local Kupo (IFetcher) and Ogmios
 * (IEvaluator + ISubmitter) providers. Replaces the per-function
 * getBlockfrostProvider() pattern in transactionBuilder.ts.
 *
 * Ports match the Tauri-managed processes from Phase 2:
 *   - Kupo:   http://127.0.0.1:44203
 *   - Ogmios: http://127.0.0.1:1337
 * Uses 127.0.0.1 instead of localhost to avoid IPv6 resolution issues.
 *
 * All Ogmios calls are routed through Tauri IPC (invoke → reqwest POST)
 * instead of WebSocket. WebKitGTK blocks WebSocket connections from
 * tauri:// scheme to ws://127.0.0.1 on some distros.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Action } from '@meshsdk/core';
import { KupoAdapter } from './kupoAdapter';

/**
 * Ogmios provider that uses Tauri IPC (HTTP POST via reqwest) instead of
 * WebSocket. Bypasses WebKitGTK WebSocket CORS/scheme restrictions.
 *
 * Implements both IEvaluator and ISubmitter interfaces for MeshTxBuilder.
 *
 * Also fixes the WITHDRAW→REWARD tag mismatch: OgmiosProvider returns
 * withdrawal results with tag "WITHDRAW", but MeshTxBuilder.updateRedeemer
 * expects tag "REWARD".
 */
class IpcOgmiosProvider {
  private async rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
      id: null,
    });
    const responseText = await invoke<string>('ogmios_post', { body });
    const json = JSON.parse(responseText);
    if (json.error) {
      throw new Error(JSON.stringify(json.error));
    }
    return json.result;
  }

  async evaluateTx(tx: string): Promise<Omit<Action, 'data'>[]> {
    const result = await this.rpc('evaluateTransaction', {
      transaction: { cbor: tx },
    }) as Record<string, { validator: { index: number; purpose: string }; budget: { memory: number; cpu: number } }>;

    return Object.values(result).map((val) => ({
      index: val.validator.index,
      tag: val.validator.purpose.toUpperCase() === 'WITHDRAW'
        ? 'REWARD' as Action['tag']
        : val.validator.purpose.toUpperCase() as Action['tag'],
      budget: {
        mem: val.budget.memory,
        steps: val.budget.cpu,
      },
    }));
  }

  async submitTx(tx: string): Promise<string> {
    const result = await this.rpc('submitTransaction', {
      transaction: { cbor: tx },
    }) as { transaction: { id: string } };

    if (!result?.transaction?.id) {
      throw new Error(`Ogmios submitTx: unexpected response: ${JSON.stringify(result)}`);
    }
    return result.transaction.id;
  }
}

let _kupo: KupoAdapter | null = null;
let _ogmios: IpcOgmiosProvider | null = null;

/** Local Kupo adapter — implements IFetcher for UTxO queries. */
export function getKupoAdapter(): KupoAdapter {
  if (!_kupo) {
    _kupo = new KupoAdapter('http://127.0.0.1:44203');
  }
  return _kupo;
}

/** Local Ogmios provider — implements IEvaluator + ISubmitter via Tauri IPC. */
export function getOgmiosProvider(): IpcOgmiosProvider {
  if (!_ogmios) {
    _ogmios = new IpcOgmiosProvider();
  }
  return _ogmios;
}
