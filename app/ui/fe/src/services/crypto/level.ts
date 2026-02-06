/**
 * Encryption Level Structures
 *
 * Ported from Python: src/level.py
 * Represents half-level and full-level encryption entries.
 */

/**
 * Half-level encryption entry (before re-encryption hop).
 */
export interface HalfLevel {
  r1: string; // G1 point (96 hex chars)
  r2_g1: string; // G1 component (96 hex chars)
  r4: string; // G2 point (192 hex chars) - commitment computed from H1, H2, H3
}

/**
 * Full-level encryption entry (after re-encryption hop).
 */
export interface FullLevel {
  r1: string; // G1 point (96 hex chars)
  r2_g1: string; // G1 component (96 hex chars)
  r2_g2: string; // G2 component (192 hex chars)
  r4: string; // G2 point (192 hex chars) - commitment computed from H1, H2, H3
}

/**
 * Convert a HalfLevel to Plutus/Aiken JSON format.
 */
export function halfLevelToPlutusJson(level: HalfLevel): object {
  return {
    constructor: 0,
    fields: [{ bytes: level.r1 }, { bytes: level.r2_g1 }, { bytes: level.r4 }],
  };
}

/**
 * Convert a FullLevel to Plutus/Aiken JSON format.
 * Uses constructor 0 with nested structure for the G2 component.
 */
export function fullLevelToPlutusJson(level: FullLevel): object {
  return {
    constructor: 0,
    fields: [
      {
        constructor: 0,
        fields: [
          { bytes: level.r1 },
          { bytes: level.r2_g1 },
          { bytes: level.r2_g2 },
          { bytes: level.r4 },
        ],
      },
    ],
  };
}

/**
 * Create an empty full-level JSON (constructor 1 - Nothing variant).
 */
export function emptyFullLevelToPlutusJson(): object {
  return {
    constructor: 1,
    fields: [],
  };
}
