import type { Request, Response, NextFunction } from 'express';

export function isValidHex(value: string): boolean {
  return /^[0-9a-fA-F]*$/.test(value);
}

export function isValidPkh(value: string): boolean {
  return value.length === 56 && isValidHex(value);
}

export function isValidTokenName(value: string): boolean {
  return value.length > 0 && value.length <= 64 && isValidHex(value);
}

export function isValidTxHash(value: string): boolean {
  return value.length === 64 && isValidHex(value);
}

type ParamValidator = (value: string) => boolean;

export function validateParam(
  paramName: string,
  validator: ParamValidator,
  errorMessage: string,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.params[paramName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !validator(value)) {
      res.status(400).json({
        error: {
          code: 'INVALID_PARAM',
          message: errorMessage,
        },
      });
      return;
    }
    next();
  };
}

export const validatePkhParam = validateParam(
  'pkh', isValidPkh,
  'Payment key hash must be 56 hex characters',
);

export const validateTokenNameParam = validateParam(
  'tokenName', isValidTokenName,
  'Token name must be 1-64 hex characters',
);

export const validateTxHashParam = validateParam(
  'txHash', isValidTxHash,
  'Transaction hash must be 64 hex characters',
);

export const validateEncryptionTokenParam = validateParam(
  'encryptionToken', isValidTokenName,
  'Encryption token must be 1-64 hex characters',
);
