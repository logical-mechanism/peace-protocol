/**
 * Centralized error-to-friendly-message mapping.
 *
 * Translates raw error strings from Tauri, network, Kupo, Ogmios, Iagon, etc.
 * into user-friendly messages with suggested actions.
 */

export interface FriendlyError {
  title: string;
  message: string;
  action?: string;
  recoverable: boolean;
}

interface ErrorPattern {
  test: (error: string) => boolean;
  result: FriendlyError;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Kupo unavailable (specific error code from backend) — must be before generic patterns
  {
    test: (e) => /KUPO_UNAVAILABLE/i.test(e),
    result: {
      title: 'Kupo Unavailable',
      message: 'The UTxO indexer is starting up or unreachable.',
      action: 'Wait for the node to finish syncing, then try again.',
      recoverable: true,
    },
  },
  // Kupo (local UTxO indexer) — must be before generic network
  {
    test: (e) => /44203|kupo/i.test(e),
    result: {
      title: 'Kupo Unavailable',
      message: 'The UTxO indexer is not responding.',
      action: 'Wait for the node to finish syncing, or check Settings for process status.',
      recoverable: true,
    },
  },
  // Ogmios POST timeout — node connection degraded (must be before generic Ogmios)
  {
    test: (e) => /ogmios post timed out/i.test(e),
    result: {
      title: 'Ogmios Request Timed Out',
      message: 'The transaction service did not respond in time. The node connection may be degraded.',
      action: 'Try restarting the node from Settings, or wait for the node to fully sync.',
      recoverable: true,
    },
  },
  // Ogmios POST connect failure (must be before generic Ogmios)
  {
    test: (e) => /ogmios post connect failed/i.test(e),
    result: {
      title: 'Cannot Reach Ogmios',
      message: 'The transaction service is not reachable on its expected port.',
      action: 'Ensure the node is running, or restart from Settings.',
      recoverable: true,
    },
  },
  // Ogmios (tx submission) — generic fallback
  {
    test: (e) => /1337|ogmios/i.test(e),
    result: {
      title: 'Ogmios Unavailable',
      message: 'The transaction submission service is not responding.',
      action: 'Wait for the node to finish syncing, or check Settings for process status.',
      recoverable: true,
    },
  },
  // Network / connectivity
  {
    test: (e) => /failed to fetch|networkerror|net::err|econnrefused|econnreset/i.test(e),
    result: {
      title: 'Network Error',
      message: 'Could not connect to the required service.',
      action: 'Check your internet connection and ensure the node is running.',
      recoverable: true,
    },
  },
  // No collateral set — must be before generic collateral/balance matches
  {
    test: (e) => /no collateral set|no collateral utxo/i.test(e),
    result: {
      title: 'No Collateral',
      message: 'Your wallet needs a dedicated 5 ADA collateral UTxO for smart contract transactions.',
      action: 'Go to Settings > Wallet and click "Set Collateral".',
      recoverable: true,
    },
  },
  // Insufficient funds for collateral creation
  {
    test: (e) => /insufficient funds.*collateral|need at least.*6\.5.*ada/i.test(e),
    result: {
      title: 'Insufficient Funds for Collateral',
      message: 'Your wallet does not have enough ADA to create a collateral UTxO.',
      action: 'Send at least 10 ADA to your wallet address.',
      recoverable: true,
    },
  },
  // Insufficient collateral — must be before generic "insufficient" balance match
  {
    test: (e) => /insufficient.*collateral|collateral.*insufficient/i.test(e),
    result: {
      title: 'Insufficient Collateral',
      message: 'The transaction requires more collateral than is available.',
      action: 'Ensure your wallet has a UTxO set as collateral. Try refreshing your wallet balance.',
      recoverable: true,
    },
  },
  // Wallet balance / min-UTxO
  {
    test: (e) => /insufficient|balance|min.?ada|not enough|utxo.*too.*small/i.test(e),
    result: {
      title: 'Insufficient Balance',
      message: 'Your wallet does not have enough ADA for this transaction.',
      action: 'Add more ADA to your wallet and try again.',
      recoverable: false,
    },
  },
  // Iagon auth failure — must be before generic Iagon pattern
  {
    test: (e) => /iagon|gw\.iagon\.com/i.test(e) && /invalid.*api.*key|api.*key.*(?:invalid|expired)|unauthorized|401/i.test(e),
    result: {
      title: 'Iagon Authentication Failed',
      message: 'Your Iagon API key is invalid or expired.',
      action: 'Go to Settings → Data Layer and re-authenticate.',
      recoverable: true,
    },
  },
  // Iagon file too large — must be before generic Iagon pattern
  {
    test: (e) => /FILE_TOO_LARGE/i.test(e) || (/iagon|gw\.iagon\.com/i.test(e) && /413|file.*too.*large/i.test(e)),
    result: {
      title: 'File Too Large for Iagon',
      message: 'Iagon does not support uploading files this large.',
      action: 'Choose a file under 200 MB.',
      recoverable: true,
    },
  },
  // Iagon quota — must be before generic Iagon pattern
  {
    test: (e) => /iagon|gw\.iagon\.com/i.test(e) && /quota|storage.*full/i.test(e),
    result: {
      title: 'Iagon Storage Full',
      message: 'Your Iagon account storage quota is full.',
      action: 'Check your Iagon account storage usage.',
      recoverable: true,
    },
  },
  // Iagon storage (generic fallback)
  {
    test: (e) => /iagon|gw\.iagon\.com/i.test(e),
    result: {
      title: 'Storage Service Error',
      message: 'Could not reach the Iagon decentralized storage service.',
      action: 'Check your internet connection. Iagon may be temporarily unavailable.',
      recoverable: true,
    },
  },
  // Timeout
  {
    test: (e) => /timeout|timed?\s*out|deadline/i.test(e),
    result: {
      title: 'Request Timed Out',
      message: 'The operation took too long to complete.',
      action: 'Try again. If the problem persists, the service may be under heavy load.',
      recoverable: true,
    },
  },
  // Mnemonic checksum validation
  {
    test: (e) => /checksum.*failed|invalid.*mnemonic/i.test(e),
    result: {
      title: 'Invalid Recovery Phrase',
      message: 'The recovery phrase has an invalid checksum. One or more words may be incorrect.',
      action: 'Double-check each word against your written backup and try again.',
      recoverable: true,
    },
  },
  // Password policy (defense-in-depth, frontend already enforces)
  {
    test: (e) => /password must be at least/i.test(e),
    result: {
      title: 'Password Too Short',
      message: 'The password must be at least 12 characters long.',
      action: 'Choose a longer password that meets all the requirements shown.',
      recoverable: true,
    },
  },
  // Wallet / signing
  {
    test: (e) => /sign|wallet.*lock|mnemonic|decrypt.*wallet/i.test(e),
    result: {
      title: 'Wallet Error',
      message: 'There was a problem with the wallet operation.',
      action: 'Try unlocking your wallet again. If the issue persists, restart the app.',
      recoverable: true,
    },
  },
  // Incorrect password
  {
    test: (e) => /incorrect.*password|wrong.*password|argon2.*mismatch|decryption.*failed/i.test(e),
    result: {
      title: 'Incorrect Password',
      message: 'The password you entered is incorrect.',
      action: 'Double-check your password and try again.',
      recoverable: true,
    },
  },
  // SNARK memory — must be before generic SNARK pattern
  {
    test: (e) => /out of memory|allocation failed|cannot allocate|oom|memory.*exhaust/i.test(e),
    result: {
      title: 'Not Enough Memory',
      message: 'The proof generation ran out of memory.',
      action: 'Close other applications to free memory and try again.',
      recoverable: true,
    },
  },
  // SNARK setup files missing — must be before generic SNARK pattern
  {
    test: (e) => /setup.*not found|pk\.bin|ccs\.bin|setup files|verification key/i.test(e),
    result: {
      title: 'SNARK Setup Files Missing',
      message: 'Required SNARK setup files could not be found.',
      action: 'Go to Settings to re-download the SNARK setup files.',
      recoverable: true,
    },
  },
  // SNARK already in progress — must be before generic SNARK pattern
  {
    test: (e) => /already in progress/i.test(e),
    result: {
      title: 'Proof Already Running',
      message: 'A zero-knowledge proof is already being generated.',
      action: 'Wait for the current proof to finish before starting another.',
      recoverable: true,
    },
  },
  // SNARK prover (generic fallback)
  {
    test: (e) => /snark|proof|prover|proving/i.test(e),
    result: {
      title: 'Proof Generation Error',
      message: 'The SNARK prover encountered an error.',
      action: 'Try again. If the problem persists, check that setup files are properly installed.',
      recoverable: true,
    },
  },
  // Specific transaction failures — must be before generic tx failure pattern
  {
    test: (e) => /script.*(?:execution|evaluation).*fail|exunits.*exceeded|budget.*exceeded|eval.*error/i.test(e),
    result: {
      title: 'Script Validation Failed',
      message: 'A smart contract script failed during validation.',
      action: 'The on-chain state may have changed. Refresh and try again.',
      recoverable: true,
    },
  },
  {
    test: (e) => /already.*spent|utxo.*not.*found|input.*consumed|conflicting.*input/i.test(e),
    result: {
      title: 'Transaction Conflict',
      message: 'One or more inputs have already been spent by another transaction.',
      action: 'Someone else may have acted on this listing. Refresh the page and try again.',
      recoverable: true,
    },
  },
  {
    test: (e) => /fee.*(?:too.*low|insufficient)|minimum.*fee|feeTooSmall/i.test(e),
    result: {
      title: 'Transaction Fee Error',
      message: 'The transaction fee was calculated too low.',
      action: 'Try again. If the issue persists, restart the app to refresh fee parameters.',
      recoverable: true,
    },
  },
  // Generic transaction submission failures (catch-all for tx errors)
  {
    test: (e) => /submit.*fail|transaction.*(?:fail|reject)|tx.*reject|phase.?2|script.*fail/i.test(e),
    result: {
      title: 'Transaction Failed',
      message: 'The transaction could not be submitted to the blockchain.',
      action: 'The on-chain state may have changed. Refresh and try again.',
      recoverable: true,
    },
  },
  // CORS / forbidden
  {
    test: (e) => /cors|forbidden|403|401|unauthorized/i.test(e),
    result: {
      title: 'Access Denied',
      message: 'The request was blocked by the server.',
      action: 'This may be a configuration issue. Try restarting the app.',
      recoverable: true,
    },
  },
  // Disk / storage
  {
    test: (e) => /disk.*full|no.*space|enospc/i.test(e),
    result: {
      title: 'Disk Full',
      message: 'There is not enough disk space to complete this operation.',
      action: 'Free up disk space and try again. Check Settings > Storage for cleanup options.',
      recoverable: false,
    },
  },
  // Port conflicts
  {
    test: (e) => /port.*in.*use|address.*already.*in.*use|eaddrinuse/i.test(e),
    result: {
      title: 'Port Conflict',
      message: 'A required port is already in use by another process.',
      action: 'Close other applications that may be using the port, or restart the app.',
      recoverable: true,
    },
  },
];

/**
 * Convert a raw error string into a user-friendly error with suggested action.
 */
export function getFriendlyError(rawError: string | Error): FriendlyError {
  const errorStr = rawError instanceof Error ? rawError.message : rawError;

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(errorStr)) {
      return pattern.result;
    }
  }

  // Default fallback
  return {
    title: 'Something Went Wrong',
    message: errorStr.length > 200 ? errorStr.slice(0, 200) + '...' : errorStr,
    action: 'Try again. If the problem persists, restart the app.',
    recoverable: true,
  };
}
