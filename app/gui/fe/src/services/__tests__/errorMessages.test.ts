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
    it('matches iagon keyword', () => {
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
    it('matches snark keyword', () => {
      expectTitle('SNARK prove exited with code 1', 'Proof Generation Error');
    });

    it('matches prover keyword', () => {
      expectTitle('Prover setup files not found', 'Proof Generation Error');
    });
  });

  describe('transaction errors', () => {
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
