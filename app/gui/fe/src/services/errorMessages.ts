/**
 * Centralized error-to-friendly-message mapping.
 *
 * Translates raw error strings from Tauri, network, Kupo, Ogmios, Iagon, etc.
 * into user-friendly messages with suggested actions. Strings live in the
 * i18n `errors` namespace; this module only decides *which* key matches a
 * raw error and resolves it through i18next.
 */

import i18n from '../i18n'

export interface FriendlyError {
  title: string;
  message: string;
  action?: string;
  recoverable: boolean;
}

interface ErrorPattern {
  test: (error: string) => boolean;
  key: string;
  recoverable: boolean;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  { test: (e) => /KUPO_UNAVAILABLE/i.test(e), key: 'kupoUnavailableCoded', recoverable: true },
  { test: (e) => /44203|kupo/i.test(e), key: 'kupoUnavailable', recoverable: true },
  { test: (e) => /ogmios post timed out/i.test(e), key: 'ogmiosPostTimeout', recoverable: true },
  { test: (e) => /ogmios post connect failed/i.test(e), key: 'ogmiosConnectFailed', recoverable: true },
  { test: (e) => /1337|ogmios/i.test(e), key: 'ogmiosUnavailable', recoverable: true },
  { test: (e) => /failed to fetch|networkerror|net::err|econnrefused|econnreset/i.test(e), key: 'network', recoverable: true },
  { test: (e) => /no collateral set|no collateral utxo/i.test(e), key: 'noCollateral', recoverable: true },
  { test: (e) => /insufficient funds.*collateral|need at least.*6\.5.*ada/i.test(e), key: 'collateralFundsInsufficient', recoverable: true },
  { test: (e) => /insufficient.*collateral|collateral.*insufficient/i.test(e), key: 'collateralInsufficient', recoverable: true },
  { test: (e) => /insufficient|balance|min.?ada|not enough|utxo.*too.*small/i.test(e), key: 'insufficientBalance', recoverable: false },
  { test: (e) => /iagon|gw\.iagon\.com/i.test(e) && /invalid.*api.*key|api.*key.*(?:invalid|expired)|unauthorized|401/i.test(e), key: 'iagonAuth', recoverable: true },
  { test: (e) => /FILE_TOO_LARGE/i.test(e) || (/iagon|gw\.iagon\.com/i.test(e) && /413|file.*too.*large/i.test(e)), key: 'iagonFileTooLarge', recoverable: true },
  { test: (e) => /iagon|gw\.iagon\.com/i.test(e) && /quota|storage.*full/i.test(e), key: 'iagonQuota', recoverable: true },
  { test: (e) => /iagon|gw\.iagon\.com/i.test(e), key: 'iagonGeneric', recoverable: true },
  { test: (e) => /timeout|timed?\s*out|deadline/i.test(e), key: 'timeout', recoverable: true },
  { test: (e) => /checksum.*failed|invalid.*mnemonic/i.test(e), key: 'mnemonicChecksum', recoverable: true },
  { test: (e) => /password must be at least/i.test(e), key: 'passwordTooShort', recoverable: true },
  { test: (e) => /sign|wallet.*lock|mnemonic|decrypt.*wallet/i.test(e), key: 'walletGeneric', recoverable: true },
  { test: (e) => /incorrect.*password|wrong.*password|argon2.*mismatch|decryption.*failed/i.test(e), key: 'incorrectPassword', recoverable: true },
  { test: (e) => /out of memory|allocation failed|cannot allocate|oom|memory.*exhaust/i.test(e), key: 'snarkOom', recoverable: true },
  { test: (e) => /setup.*not found|pk\.bin|ccs\.bin|setup files|verification key/i.test(e), key: 'snarkSetupMissing', recoverable: true },
  { test: (e) => /already in progress/i.test(e), key: 'snarkInProgress', recoverable: true },
  { test: (e) => /snark|proof|prover|proving/i.test(e), key: 'snarkGeneric', recoverable: true },
  { test: (e) => /script.*(?:execution|evaluation).*fail|exunits.*exceeded|budget.*exceeded|eval.*error/i.test(e), key: 'scriptValidation', recoverable: true },
  { test: (e) => /already.*spent|utxo.*not.*found|input.*consumed|conflicting.*input/i.test(e), key: 'txConflict', recoverable: true },
  { test: (e) => /fee.*(?:too.*low|insufficient)|minimum.*fee|feeTooSmall/i.test(e), key: 'feeError', recoverable: true },
  { test: (e) => /submit.*fail|transaction.*(?:fail|reject)|tx.*reject|phase.?2|script.*fail/i.test(e), key: 'txFailed', recoverable: true },
  { test: (e) => /cors|forbidden|403|401|unauthorized/i.test(e), key: 'accessDenied', recoverable: true },
  { test: (e) => /disk.*full|no.*space|enospc/i.test(e), key: 'diskFull', recoverable: false },
  { test: (e) => /port.*in.*use|address.*already.*in.*use|eaddrinuse/i.test(e), key: 'portConflict', recoverable: true },
];

function tr(key: string, leaf: string): string {
  // Using the fixed 'errors' namespace for every entry.
  return i18n.t(`errors:${key}.${leaf}`)
}

/**
 * Convert a raw error string into a user-friendly error with suggested action.
 */
export function getFriendlyError(rawError: string | Error): FriendlyError {
  const errorStr = rawError instanceof Error ? rawError.message : rawError;

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(errorStr)) {
      return {
        title: tr(pattern.key, 'title'),
        message: tr(pattern.key, 'message'),
        action: tr(pattern.key, 'action'),
        recoverable: pattern.recoverable,
      };
    }
  }

  // Default fallback uses the raw message so the user still sees what failed.
  return {
    title: tr('fallback', 'title'),
    message: errorStr.length > 200 ? errorStr.slice(0, 200) + '...' : errorStr,
    action: tr('fallback', 'action'),
    recoverable: true,
  };
}
