/**
 * Constants for RNA folding
 * Based on ViennaRNA package
 */

export const INF = 10000000;  // Infinity value for impossible configurations
export const NBPAIRS = 7;     // Number of base pair types
export const MAXLOOP = 30;    // Maximum loop size for lookup tables
export const K0 = 273.15;     // Kelvin offset
export const GASCONST = 1.98717;  // Gas constant in cal/(mol*K)
export const Tmeasure = 37 + K0;  // Temperature of parameter measurements (37°C)

// Minimum hairpin loop size
export const MIN_HAIRPIN_SIZE = 3;

// Base encoding
export const Base = {
  N: 0,  // Unknown/Any
  A: 1,
  C: 2,
  G: 3,
  U: 4,
  T: 4,  // Treat T as U
} as const;

export type BaseType = typeof Base[keyof typeof Base];

// Base pair types
export const PairType = {
  NONE: 0,
  CG: 1,
  GC: 2,
  GU: 3,
  UG: 4,
  AU: 5,
  UA: 6,
  NN: 7,  // Non-standard pair
} as const;

export type PairTypeValue = typeof PairType[keyof typeof PairType];
