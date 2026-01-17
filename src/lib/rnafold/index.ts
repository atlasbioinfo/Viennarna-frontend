/**
 * RNAfold TypeScript Implementation
 * Based on ViennaRNA Package
 *
 * Provides RNA secondary structure prediction using minimum free energy (MFE)
 * algorithm based on Zuker's dynamic programming approach.
 */

export { fold, evalStructure, type FoldResult } from './fold';
export { cleanSequence, isValidSequence, encodeSequence } from './sequence';
export { Base, PairType, INF, MIN_HAIRPIN_SIZE } from './constants';
export * as energyParams from './energyParams';
