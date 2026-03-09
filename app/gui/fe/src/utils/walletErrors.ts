export interface UnlockErrorInfo {
  title: string
  suggestion: string
  raw: string
}

/**
 * Parses Tauri wallet unlock errors into user-friendly messages.
 *
 * Note: Tauri invoke() rejects with a plain string for Rust Err(String),
 * not an Error object. This function handles both cases.
 */
export function parseUnlockError(raw: unknown): UnlockErrorInfo {
  const message =
    typeof raw === 'string'
      ? raw
      : raw instanceof Error
        ? raw.message
        : String(raw)

  if (message === 'Incorrect password') {
    return {
      title: 'Incorrect password',
      suggestion: 'Please check your password and try again.',
      raw: message,
    }
  }

  if (
    message.includes('Invalid wallet file') ||
    message.includes('bad nonce') ||
    message.includes('not valid UTF-8')
  ) {
    return {
      title: 'Wallet file corrupted',
      suggestion:
        'Your wallet file appears to be damaged. You can delete this wallet and restore from your 24-word recovery phrase.',
      raw: message,
    }
  }

  if (message.includes('Failed to read wallet file')) {
    return {
      title: 'Cannot read wallet file',
      suggestion:
        'Check that the application has permission to access its data directory.',
      raw: message,
    }
  }

  if (message.includes('Key derivation failed')) {
    return {
      title: 'Key derivation failed',
      suggestion:
        'An internal cryptographic error occurred. Try restarting the application.',
      raw: message,
    }
  }

  return {
    title: 'Unlock failed',
    suggestion: message,
    raw: message,
  }
}
