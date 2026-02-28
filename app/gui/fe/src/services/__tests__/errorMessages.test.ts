import { describe, it, expect } from 'vitest';
import { getFriendlyError, type FriendlyError } from '../errorMessages';

describe('getFriendlyError', () => {
  // Helper to assert title matches expected
  const expectTitle = (error: string, expectedTitle: string) => {
    expect(getFriendlyError(error).title).toBe(expectedTitle);
  };

  describe('network errors', () => {
    it('matches "Failed to fetch"', () => {
      expectTitle('Failed to fetch', 'Network Error');
    });

    it('matches "NetworkError when attempting to fetch resource"', () => {
      expectTitle('NetworkError when attempting to fetch resource', 'Network Error');
    });

    it('matches ECONNREFUSED', () => {
      expectTitle('connect ECONNREFUSED 127.0.0.1:3001', 'Network Error');
    });
  });

  describe('Kupo errors', () => {
    it('matches KUPO_UNAVAILABLE error code', () => {
      expectTitle('KUPO_UNAVAILABLE', 'Kupo Unavailable');
      const result = getFriendlyError('KUPO_UNAVAILABLE');
      expect(result.message).toBe('The UTxO indexer is starting up or unreachable.');
      expect(result.action).toBe('Wait for the node to finish syncing, then try again.');
    });

    it('matches port 1442', () => {
      expectTitle('connect ECONNREFUSED 127.0.0.1:1442', 'Kupo Unavailable');
    });

    it('matches kupo keyword', () => {
      expectTitle('Kupo returned error 500', 'Kupo Unavailable');
    });
  });

  describe('Ogmios errors', () => {
    it('matches port 1337', () => {
      expectTitle('WebSocket connection to 127.0.0.1:1337 failed', 'Ogmios Unavailable');
    });

    it('matches ogmios keyword', () => {
      expectTitle('Ogmios evaluation failed', 'Ogmios Unavailable');
    });
  });

  describe('balance errors', () => {
    it('matches insufficient balance', () => {
      expectTitle('Insufficient balance for transaction', 'Insufficient Balance');
    });

    it('matches min ADA', () => {
      expectTitle('UTxO does not meet minAda requirement', 'Insufficient Balance');
    });

    it('matches "not enough"', () => {
      expectTitle('Not enough ADA in wallet', 'Insufficient Balance');
    });
  });

  describe('Iagon errors', () => {
    it('matches iagon auth failure with invalid api key', () => {
      expectTitle('Iagon: invalid api key', 'Iagon Authentication Failed');
    });

    it('matches iagon auth failure with unauthorized', () => {
      expectTitle('gw.iagon.com returned 401 Unauthorized', 'Iagon Authentication Failed');
    });

    it('matches iagon auth failure with expired key', () => {
      expectTitle('Iagon API key expired', 'Iagon Authentication Failed');
      expect(getFriendlyError('Iagon API key expired').action).toContain('Settings');
    });

    it('matches iagon quota error with 413', () => {
      expectTitle('Iagon upload returned 413', 'Iagon Storage Limit');
    });

    it('matches iagon storage full', () => {
      expectTitle('Iagon: storage full', 'Iagon Storage Limit');
    });

    it('matches iagon file too large', () => {
      expectTitle('Iagon: file too large for upload', 'Iagon Storage Limit');
    });

    it('matches generic iagon keyword', () => {
      expectTitle('Iagon upload failed with status 500', 'Storage Service Error');
    });

    it('matches gw.iagon.com', () => {
      expectTitle('Failed to reach gw.iagon.com', 'Storage Service Error');
    });
  });

  describe('timeout errors', () => {
    it('matches timeout', () => {
      expectTitle('Request timeout after 60000ms', 'Request Timed Out');
    });

    it('matches timed out', () => {
      expectTitle('Connection timed out', 'Request Timed Out');
    });
  });

  describe('mnemonic checksum errors', () => {
    it('matches checksum verification failed', () => {
      expectTitle(
        'Invalid mnemonic: checksum verification failed. Please double-check your recovery phrase for typos.',
        'Invalid Recovery Phrase',
      );
    });

    it('matches invalid mnemonic', () => {
      expectTitle('Invalid mnemonic: bad word at index 3', 'Invalid Recovery Phrase');
    });
  });

  describe('password policy errors', () => {
    it('matches password too short', () => {
      expectTitle('Password must be at least 12 characters', 'Password Too Short');
    });
  });

  describe('wallet errors', () => {
    it('matches incorrect password', () => {
      expectTitle('Incorrect password', 'Incorrect Password');
    });

    it('matches decryption failed', () => {
      expectTitle('Decryption failed', 'Incorrect Password');
    });

    it('matches sign error', () => {
      expectTitle('Failed to sign transaction', 'Wallet Error');
    });
  });

  describe('SNARK errors', () => {
    it('matches out of memory', () => {
      expectTitle('out of memory during proof generation', 'Not Enough Memory');
    });

    it('matches allocation failed', () => {
      expectTitle('allocation failed: cannot allocate 4GB', 'Not Enough Memory');
    });

    it('matches OOM', () => {
      expectTitle('Process killed: OOM', 'Not Enough Memory');
      expect(getFriendlyError('Process killed: OOM').action).toContain('Close other applications');
    });

    it('matches setup files not found', () => {
      expectTitle('setup files not found in /path/to/snark', 'SNARK Setup Files Missing');
    });

    it('matches pk.bin reference', () => {
      expectTitle('Cannot read pk.bin: file missing', 'SNARK Setup Files Missing');
    });

    it('matches ccs.bin reference', () => {
      expectTitle('Failed to load ccs.bin', 'SNARK Setup Files Missing');
      expect(getFriendlyError('Failed to load ccs.bin').action).toContain('Settings');
    });

    it('matches generic snark keyword', () => {
      expectTitle('SNARK prove exited with code 1', 'Proof Generation Error');
    });

    it('matches prover keyword', () => {
      expectTitle('Prover encountered an unexpected error', 'Proof Generation Error');
    });
  });

  describe('specific transaction errors', () => {
    it('matches insufficient collateral', () => {
      expectTitle('Insufficient collateral for transaction', 'Insufficient Collateral');
    });

    it('matches collateral insufficient', () => {
      expectTitle('Collateral insufficient: need 5 ADA', 'Insufficient Collateral');
    });

    it('matches script execution failure', () => {
      expectTitle('Script execution failed in phase 2', 'Script Validation Failed');
    });

    it('matches script evaluation failure', () => {
      expectTitle('Script evaluation failed: budget exceeded', 'Script Validation Failed');
    });

    it('matches ExUnits exceeded', () => {
      expectTitle('ExUnits exceeded for script', 'Script Validation Failed');
    });

    it('matches budget exceeded', () => {
      expectTitle('Budget exceeded during script validation', 'Script Validation Failed');
    });

    it('matches already spent UTxO', () => {
      expectTitle('Input already spent in a previous transaction', 'Transaction Conflict');
    });

    it('matches UTxO not found', () => {
      expectTitle('UTxO not found at the given reference', 'Transaction Conflict');
    });

    it('matches conflicting input', () => {
      expectTitle('Conflicting input detected', 'Transaction Conflict');
    });

    it('matches fee too low', () => {
      expectTitle('Fee too low: minimum required 200000', 'Transaction Fee Error');
    });

    it('matches minimum fee', () => {
      expectTitle('Below minimum fee threshold', 'Transaction Fee Error');
    });

    it('matches feeTooSmall', () => {
      expectTitle('feeTooSmall: provided 170000, required 185000', 'Transaction Fee Error');
    });
  });

  describe('generic transaction errors', () => {
    it('matches submit failure', () => {
      expectTitle('Submit failed: phase-2 validation error', 'Transaction Failed');
    });

    it('matches tx rejected', () => {
      expectTitle('Transaction rejected by ledger', 'Transaction Failed');
    });
  });

  describe('disk errors', () => {
    it('matches disk full', () => {
      expectTitle('Disk full, cannot write file', 'Disk Full');
      expect(getFriendlyError('Disk full').recoverable).toBe(false);
    });

    it('matches ENOSPC', () => {
      expectTitle('ENOSPC: no space left on device', 'Disk Full');
    });
  });

  describe('port errors', () => {
    it('matches port in use', () => {
      expectTitle('Port 3001 is already in use', 'Port Conflict');
    });

    it('matches EADDRINUSE', () => {
      expectTitle('EADDRINUSE: address already in use', 'Port Conflict');
    });
  });

  describe('default fallback', () => {
    it('returns generic error for unknown strings', () => {
      const result = getFriendlyError('Some obscure error nobody expected');
      expect(result.title).toBe('Something Went Wrong');
      expect(result.message).toBe('Some obscure error nobody expected');
      expect(result.recoverable).toBe(true);
    });

    it('truncates very long error messages', () => {
      const longError = 'a'.repeat(300);
      const result = getFriendlyError(longError);
      expect(result.message.length).toBeLessThanOrEqual(203); // 200 + "..."
    });

    it('accepts Error objects', () => {
      const result = getFriendlyError(new Error('Failed to fetch'));
      expect(result.title).toBe('Network Error');
    });
  });

  describe('error properties', () => {
    it('all results have required fields', () => {
      const testCases = [
        'Failed to fetch',
        'Kupo error',
        'Ogmios error',
        'Insufficient balance',
        'Iagon error',
        'timeout',
        'Failed to sign',
        'SNARK prove error',
        'Submit failed',
        'Unknown error',
      ];

      for (const error of testCases) {
        const result: FriendlyError = getFriendlyError(error);
        expect(result.title).toBeTruthy();
        expect(result.message).toBeTruthy();
        expect(typeof result.recoverable).toBe('boolean');
      }
    });
  });
});
