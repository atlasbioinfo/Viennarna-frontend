/**
 * Sequence encoding and base pair utilities
 */

import { Base, PairType, type BaseType, type PairTypeValue } from './constants';

/**
 * Encode a single nucleotide character to Base enum
 */
export function encodeBase(char: string): BaseType {
  switch (char.toUpperCase()) {
    case 'A': return Base.A;
    case 'C': return Base.C;
    case 'G': return Base.G;
    case 'U': return Base.U;
    case 'T': return Base.T; // Treat T as U
    default: return Base.N;
  }
}

/**
 * Encode an RNA sequence to array of Base values
 * Returns 1-indexed array (position 0 is unused)
 */
export function encodeSequence(sequence: string): number[] {
  const encoded: number[] = [Base.N]; // 0-th position unused
  for (const char of sequence) {
    encoded.push(encodeBase(char));
  }
  return encoded;
}

/**
 * Get the base pair type for two bases
 * Returns 0 if not a valid base pair
 */
export function getPairType(base5: number, base3: number): PairTypeValue {
  // Watson-Crick pairs
  if (base5 === Base.C && base3 === Base.G) return PairType.CG;
  if (base5 === Base.G && base3 === Base.C) return PairType.GC;
  // GU wobble pairs
  if (base5 === Base.G && base3 === Base.U) return PairType.GU;
  if (base5 === Base.U && base3 === Base.G) return PairType.UG;
  // AU pairs
  if (base5 === Base.A && base3 === Base.U) return PairType.AU;
  if (base5 === Base.U && base3 === Base.A) return PairType.UA;
  // Not a valid pair
  return PairType.NONE;
}

/**
 * Get reverse complement pair type
 */
export function reversePairType(pairType: PairTypeValue): PairTypeValue {
  switch (pairType) {
    case PairType.CG: return PairType.GC;
    case PairType.GC: return PairType.CG;
    case PairType.GU: return PairType.UG;
    case PairType.UG: return PairType.GU;
    case PairType.AU: return PairType.UA;
    case PairType.UA: return PairType.AU;
    default: return PairType.NONE;
  }
}

/**
 * Check if a pair type is AU or GU (terminal penalty applies)
 */
export function isAUorGU(pairType: PairTypeValue): boolean {
  return pairType === PairType.AU ||
         pairType === PairType.UA ||
         pairType === PairType.GU ||
         pairType === PairType.UG;
}

/**
 * Check if a pair type is valid (non-zero)
 */
export function isValidPair(pairType: PairTypeValue): boolean {
  return pairType !== PairType.NONE;
}

/**
 * Clean and validate RNA sequence
 * Converts to uppercase, replaces T with U, removes whitespace
 */
export function cleanSequence(sequence: string): string {
  return sequence
    .toUpperCase()
    .replace(/T/g, 'U')
    .replace(/\s/g, '')
    .replace(/[^ACGU]/g, 'N');
}

/**
 * Validate an RNA sequence
 * Returns true if sequence contains only valid nucleotides
 */
export function isValidSequence(sequence: string): boolean {
  const cleaned = cleanSequence(sequence);
  return /^[ACGUN]*$/.test(cleaned) && !cleaned.includes('N');
}

/**
 * Get base character from encoding
 */
export function baseToChar(base: BaseType): string {
  switch (base) {
    case Base.A: return 'A';
    case Base.C: return 'C';
    case Base.G: return 'G';
    case Base.U: return 'U';
    default: return 'N';
  }
}
