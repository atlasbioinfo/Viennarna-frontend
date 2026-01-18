/**
 * RNA Secondary Structure Prediction using Minimum Free Energy (MFE)
 * Implementation based on Zuker algorithm and ViennaRNA package
 *
 * This implementation aims to match ViennaRNA RNAfold output with default parameters
 */

import { INF, MIN_HAIRPIN_SIZE, PairType, K0, Tmeasure, type PairTypeValue } from './constants';
import {
  stack37,
  hairpin37,
  bulge37,
  internalLoop37,
  mismatchH37,
  mismatchI37,
  mismatchM37,
  mismatchExt37,
  mismatch1nI37,
  mismatch23I37,
  dangle5_37,
  dangle3_37,
  TerminalAU,
  ML_intern37,
  ML_closing37,
  ML_BASE37,
  MAX_NINIO,
  ninio37,
  int11_37,
  int22_37,
  loopEnergy,
  Tetraloops,
  Triloops,
  Hexaloops,
} from './energyParams';
import { encodeSequence, getPairType, isAUorGU, cleanSequence, reversePairType } from './sequence';

/**
 * Folding options
 */
export interface FoldOptions {
  temperature?: number;    // Temperature in Celsius (default: 37)
  dangles?: number;        // Dangling end treatment: 0, 1, or 2 (default: 2)
  noLP?: boolean;          // No lonely pairs (default: false)
  noGU?: boolean;          // No G-U wobble pairs (default: false)
  noClosingGU?: boolean;   // No closing G-U pairs (default: false)
  noTetra?: boolean;       // No special tetraloop bonus (default: false)
}

/**
 * Result of RNA folding
 */
export interface FoldResult {
  sequence: string;
  structure: string;
  mfe: number;
  basePairs: Array<[number, number]>;
}

/**
 * Dynamic Programming matrices
 */
interface DPMatrices {
  c: number[][];   // Energy of structure closed by pair (i,j)
  fML: number[][]; // Energy of multibranch loop part
  f5: number[];    // Energy of structure from 1 to i
}

/**
 * Fold compound - holds all data for folding
 */
interface FoldCompound {
  sequence: string;
  encodedSeq: number[];
  length: number;
  pairType: (i: number, j: number) => PairTypeValue;
  matrices: DPMatrices;
  options: Required<FoldOptions>;
  tempScale: number;  // Temperature scaling factor
}

// Safe array access helpers
function safeGet<T>(arr: T[] | undefined, idx: number, defaultVal: T): T {
  if (!arr || idx < 0 || idx >= arr.length) return defaultVal;
  return arr[idx] ?? defaultVal;
}

function safeGet2D(arr: number[][] | undefined, i: number, j: number, defaultVal: number): number {
  if (!arr || i < 0 || i >= arr.length) return defaultVal;
  const row = arr[i];
  if (!row || j < 0 || j >= row.length) return defaultVal;
  return row[j] ?? defaultVal;
}

function safeGet3D(arr: number[][][] | undefined, i: number, j: number, k: number, defaultVal: number): number {
  if (!arr || i < 0 || i >= arr.length) return defaultVal;
  const layer = arr[i];
  if (!layer || j < 0 || j >= layer.length) return defaultVal;
  const row = layer[j];
  if (!row || k < 0 || k >= row.length) return defaultVal;
  return row[k] ?? defaultVal;
}

function safeGet4D(arr: number[][][][] | undefined, i: number, j: number, k: number, l: number, defaultVal: number): number {
  if (!arr || i < 0 || i >= arr.length) return defaultVal;
  const d1 = arr[i];
  if (!d1 || j < 0 || j >= d1.length) return defaultVal;
  const d2 = d1[j];
  if (!d2 || k < 0 || k >= d2.length) return defaultVal;
  const d3 = d2[k];
  if (!d3 || l < 0 || l >= d3.length) return defaultVal;
  return d3[l] ?? defaultVal;
}

/**
 * Get terminal AU/GU penalty
 */
function terminalPenalty(pairType: PairTypeValue): number {
  return isAUorGU(pairType) ? TerminalAU : 0;
}

/**
 * Check if pair type is allowed based on options
 */
function isPairAllowed(pairType: PairTypeValue, fc: FoldCompound): boolean {
  if (pairType === PairType.NONE) return false;
  if (fc.options.noGU && (pairType === PairType.GU || pairType === PairType.UG)) return false;
  return true;
}

/**
 * Check if closing pair is allowed (for helix ends)
 */
function isClosingPairAllowed(pairType: PairTypeValue, fc: FoldCompound): boolean {
  if (!isPairAllowed(pairType, fc)) return false;
  if (fc.options.noClosingGU && (pairType === PairType.GU || pairType === PairType.UG)) return false;
  return true;
}

/**
 * Calculate exterior stem energy (ViennaRNA vrna_E_exterior_stem)
 * @param pairType - base pair type
 * @param n5d - 5' neighbor base (or -1 if none)
 * @param n3d - 3' neighbor base (or -1 if none)
 * @param dangles - dangling end mode
 */
function exteriorStemEnergy(pairType: PairTypeValue, n5d: number, n3d: number, dangles: number): number {
  let energy = 0;

  if (dangles === 2) {
    // Use mismatchExt when both neighbors are available
    if (n5d >= 0 && n3d >= 0) {
      energy += safeGet3D(mismatchExt37, pairType, n5d, n3d, 0);
    } else if (n5d >= 0) {
      energy += safeGet2D(dangle5_37, pairType, n5d, 0);
    } else if (n3d >= 0) {
      energy += safeGet2D(dangle3_37, pairType, n3d, 0);
    }
  } else if (dangles === 0) {
    // No dangling ends
  }

  // Terminal AU penalty (type > 2 means GU, UG, AU, or UA)
  if (pairType > 2) {
    energy += TerminalAU;
  }

  return energy;
}

/**
 * Calculate hairpin loop energy
 * Following ViennaRNA's vrna_E_hairpin function
 */
function hairpinEnergy(fc: FoldCompound, i: number, j: number): number {
  const size = j - i - 1;
  const pairType = fc.pairType(i, j);

  if (size < MIN_HAIRPIN_SIZE) return INF;
  if (!isClosingPairAllowed(pairType, fc)) return INF;

  // Base hairpin energy from table
  let energy = loopEnergy(size, hairpin37);

  if (size < 3) return energy;  // Should not happen with MIN_HAIRPIN_SIZE = 3

  // Get mismatch bases
  const si1 = safeGet(fc.encodedSeq, i + 1, 0);
  const sj1 = safeGet(fc.encodedSeq, j - 1, 0);

  // Check for special loops - these REPLACE the normal energy
  if (!fc.options.noTetra) {
    if (size === 4) {
      // Tetraloop: check for special sequence
      const loopSeq = fc.sequence.substring(i - 1, j);
      for (const tl of Tetraloops) {
        if (loopSeq === tl.seq) {
          // Return the special tetraloop energy directly (it's the total energy)
          return tl.energy;
        }
      }
    } else if (size === 6) {
      // Hexaloop: check for special sequence
      const loopSeq = fc.sequence.substring(i - 1, j);
      for (const hl of Hexaloops) {
        if (loopSeq === hl.seq) {
          return hl.energy;
        }
      }
    } else if (size === 3) {
      // Triloop: check for special sequence
      const loopSeq = fc.sequence.substring(i - 1, j);
      for (const tl of Triloops) {
        if (loopSeq === tl.seq) {
          return tl.energy;
        }
      }
      // For size 3 loops that are not special triloops, add Terminal AU penalty
      // (ViennaRNA: return energy + (type > 2 ? P->TerminalAU : 0))
      return energy + terminalPenalty(pairType);
    }
  }

  // For non-special loops, add mismatch energy
  energy += safeGet3D(mismatchH37, pairType, si1, sj1, 0);

  return energy;
}

/**
 * Calculate interior loop energy (including bulges and internal loops)
 */
function interiorEnergy(fc: FoldCompound, i: number, j: number, p: number, q: number): number {
  const pairType_ij = fc.pairType(i, j);
  const pairType_pq = fc.pairType(p, q);

  if (!isClosingPairAllowed(pairType_ij, fc)) return INF;
  if (!isPairAllowed(pairType_pq, fc)) return INF;

  const n1 = p - i - 1; // 5' side unpaired
  const n2 = j - q - 1; // 3' side unpaired

  // Stacking - no loop, just stacked pairs
  if (n1 === 0 && n2 === 0) {
    return safeGet2D(stack37, pairType_ij, pairType_pq, INF);
  }

  // Bulge loop
  if (n1 === 0 || n2 === 0) {
    const size = n1 + n2;
    let energy = loopEnergy(size, bulge37);

    if (size === 1) {
      // Special case: 1-nucleotide bulge, add stacking
      energy += safeGet2D(stack37, pairType_ij, pairType_pq, 0);
    } else {
      // Terminal AU/GU penalties for both pairs
      energy += terminalPenalty(pairType_ij);
      energy += terminalPenalty(pairType_pq);
    }

    return energy;
  }

  // Internal loop
  const si1 = safeGet(fc.encodedSeq, i + 1, 0);
  const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
  const sp1 = safeGet(fc.encodedSeq, p - 1, 0);
  const sq1 = safeGet(fc.encodedSeq, q + 1, 0);

  // Get reverse pair type for inner pair (viewed from inside the loop)
  const pairType_qp = reversePairType(pairType_pq);

  let energy: number;

  if (n1 === 1 && n2 === 1) {
    // 1x1 internal loop - use special lookup table
    energy = safeGet4D(int11_37, pairType_ij, pairType_qp, si1, sj1, INF);
    if (energy >= INF) {
      // Fallback to generic calculation
      energy = loopEnergy(2, internalLoop37);
      energy += safeGet3D(mismatch1nI37, pairType_ij, si1, sj1, 0);
      energy += safeGet3D(mismatch1nI37, pairType_qp, sq1, sp1, 0);
    }
  } else if (n1 === 2 && n2 === 1) {
    // 2x1 internal loop - use generic calculation
    energy = loopEnergy(3, internalLoop37);
    energy += safeGet3D(mismatch23I37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatch23I37, pairType_qp, sq1, sp1, 0);
    energy += ninio37; // asymmetry penalty
  } else if (n1 === 1 && n2 === 2) {
    // 1x2 internal loop - use generic calculation
    energy = loopEnergy(3, internalLoop37);
    energy += safeGet3D(mismatch23I37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatch23I37, pairType_qp, sq1, sp1, 0);
    energy += ninio37; // asymmetry penalty
  } else if (n1 === 2 && n2 === 2) {
    // 2x2 internal loop - use special lookup table
    const si2 = safeGet(fc.encodedSeq, i + 2, 0);
    const sj2 = safeGet(fc.encodedSeq, j - 2, 0);
    energy = int22_37?.[pairType_ij]?.[pairType_qp]?.[si1]?.[si2]?.[sj2]?.[sj1] ?? INF;
    if (energy >= INF) {
      energy = loopEnergy(4, internalLoop37);
      energy += safeGet3D(mismatch23I37, pairType_ij, si1, sj1, 0);
      energy += safeGet3D(mismatch23I37, pairType_qp, sq1, sp1, 0);
    }
  } else {
    // General internal loop
    const size = n1 + n2;
    energy = loopEnergy(size, internalLoop37);

    // Ninio asymmetry penalty
    const asymmetry = Math.abs(n1 - n2);
    energy += Math.min(MAX_NINIO, asymmetry * ninio37);

    // Mismatch energies
    if (n1 === 1 || n2 === 1) {
      // 1xn loop
      energy += safeGet3D(mismatch1nI37, pairType_ij, si1, sj1, 0);
      energy += safeGet3D(mismatch1nI37, pairType_qp, sq1, sp1, 0);
    } else if ((n1 === 2 && n2 === 3) || (n1 === 3 && n2 === 2)) {
      // 2x3 loop
      energy += safeGet3D(mismatch23I37, pairType_ij, si1, sj1, 0);
      energy += safeGet3D(mismatch23I37, pairType_qp, sq1, sp1, 0);
    } else {
      // Generic internal loop
      energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
      energy += safeGet3D(mismatchI37, pairType_qp, sq1, sp1, 0);
    }
  }

  return energy;
}

/**
 * Initialize fold compound
 */
function createFoldCompound(sequence: string, options: FoldOptions): FoldCompound {
  const cleanedSeq = cleanSequence(sequence);
  const encodedSeq = encodeSequence(cleanedSeq);
  const n = cleanedSeq.length;

  // Default options
  const opts: Required<FoldOptions> = {
    temperature: options.temperature ?? 37,
    dangles: options.dangles ?? 2,
    noLP: options.noLP ?? false,
    noGU: options.noGU ?? false,
    noClosingGU: options.noClosingGU ?? false,
    noTetra: options.noTetra ?? false,
  };

  // Temperature scaling (for future use)
  const tempK = opts.temperature + K0;
  const tempScale = tempK / Tmeasure;

  // Initialize DP matrices
  const c: number[][] = Array(n + 1).fill(null).map(() => Array(n + 1).fill(INF));
  const fML: number[][] = Array(n + 1).fill(null).map(() => Array(n + 1).fill(INF));
  const f5: number[] = Array(n + 1).fill(0);

  const fc: FoldCompound = {
    sequence: cleanedSeq,
    encodedSeq,
    length: n,
    pairType: (i, j) => {
      const bi = safeGet(encodedSeq, i, 0);
      const bj = safeGet(encodedSeq, j, 0);
      return getPairType(bi, bj);
    },
    matrices: { c, fML, f5 },
    options: opts,
    tempScale,
  };

  return fc;
}

/**
 * Fill the DP matrices
 */
function fillMatrices(fc: FoldCompound): void {
  const n = fc.length;
  const { c, fML, f5 } = fc.matrices;
  const { dangles, noLP } = fc.options;

  // Fill matrices for increasing subsequence lengths
  for (let d = MIN_HAIRPIN_SIZE + 1; d <= n; d++) {
    for (let i = 1; i <= n - d; i++) {
      const j = i + d;

      // Check if (i,j) can form a base pair
      const pairType = fc.pairType(i, j);

      if (isClosingPairAllowed(pairType, fc)) {
        // Case 1: Hairpin loop
        let cij = hairpinEnergy(fc, i, j);

        // Case 2a: Stacking (check separately since it has no loop size limit)
        {
          const p = i + 1;
          const q = j - 1;
          if (q > p + MIN_HAIRPIN_SIZE) {
            const innerPairType = fc.pairType(p, q);
            if (isPairAllowed(innerPairType, fc)) {
              const cpq = safeGet2D(c, p, q, INF);
              if (cpq < INF) {
                const stackE = interiorEnergy(fc, i, j, p, q) + cpq;
                cij = Math.min(cij, stackE);
              }
            }
          }
        }

        // Case 2b: Interior loop (bulge and internal loops, limited by maxLoopSize)
        const maxLoopSize = 30;
        for (let p = i + 1; p <= Math.min(i + maxLoopSize + 1, j - MIN_HAIRPIN_SIZE - 2); p++) {
          const maxQ = Math.min(j - 1, p + maxLoopSize + 1 - (p - i - 1));
          for (let q = Math.max(p + MIN_HAIRPIN_SIZE + 1, j - maxLoopSize - 1 + (p - i - 1)); q <= maxQ; q++) {
            // Skip stacking case (already handled above)
            if (p === i + 1 && q === j - 1) continue;

            const innerPairType = fc.pairType(p, q);
            if (isPairAllowed(innerPairType, fc)) {
              const cpq = safeGet2D(c, p, q, INF);
              if (cpq < INF) {
                // Check noLP constraint
                if (noLP) {
                  const n1 = p - i - 1;
                  const n2 = j - q - 1;
                  // For noLP, only allow stacking (0,0) or internal loops where inner pair is also stacked
                  if (n1 === 0 && n2 === 0) {
                    // Stacking is always allowed
                  } else {
                    // Skip if this would create a lonely pair
                    continue;
                  }
                }
                const interior = interiorEnergy(fc, i, j, p, q) + cpq;
                cij = Math.min(cij, interior);
              }
            }
          }
        }

        // Case 3: Multi-loop
        let mlEnergy = INF;
        for (let k = i + MIN_HAIRPIN_SIZE + 2; k < j - MIN_HAIRPIN_SIZE - 1; k++) {
          const left = safeGet2D(fML, i + 1, k, INF);
          const right = safeGet2D(fML, k + 1, j - 1, INF);
          if (left < INF && right < INF) {
            mlEnergy = Math.min(mlEnergy, left + right);
          }
        }

        if (mlEnergy < INF) {
          const si1 = safeGet(fc.encodedSeq, i + 1, 0);
          const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
          let mlClose = mlEnergy + ML_closing37 + ML_intern37 + terminalPenalty(pairType);

          // Add mismatch for dangles=2
          if (dangles === 2) {
            mlClose += safeGet3D(mismatchM37, pairType, si1, sj1, 0);
          }

          cij = Math.min(cij, mlClose);
        }

        const cRow = c[i];
        if (cRow) cRow[j] = cij;
      }

      // Fill fML[i][j] - multibranch loop component
      let fMLij = safeGet2D(fML, i, j - 1, INF);
      if (fMLij < INF) {
        fMLij += ML_BASE37;
      }

      // Case 2: (k,j) forms a stem
      for (let k = i; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
        const stemPairType = fc.pairType(k, j);
        if (isPairAllowed(stemPairType, fc)) {
          const ckj = safeGet2D(c, k, j, INF);
          if (ckj < INF) {
            let stemContrib = ckj + ML_intern37 + terminalPenalty(stemPairType);

            // Add mismatch/dangle energies for dangles mode (following ViennaRNA E_MLstem)
            if (dangles === 2) {
              const n5d = k > 1 ? safeGet(fc.encodedSeq, k - 1, 0) : -1;
              const n3d = j < fc.length ? safeGet(fc.encodedSeq, j + 1, 0) : -1;
              if (n5d >= 0 && n3d >= 0) {
                // Both neighbors available - use mismatchM
                stemContrib += safeGet3D(mismatchM37, stemPairType, n5d, n3d, 0);
              } else if (n5d >= 0) {
                stemContrib += safeGet2D(dangle5_37, stemPairType, n5d, 0);
              } else if (n3d >= 0) {
                stemContrib += safeGet2D(dangle3_37, stemPairType, n3d, 0);
              }
            }

            if (k === i) {
              fMLij = Math.min(fMLij, stemContrib);
            } else {
              const fMLik1 = safeGet2D(fML, i, k - 1, INF);
              if (fMLik1 < INF) {
                fMLij = Math.min(fMLij, fMLik1 + stemContrib);
              }
            }
          }
        }
      }

      const fMLRow = fML[i];
      if (fMLRow) fMLRow[j] = fMLij;
    }
  }

  // Fill f5 - external loop energy (following ViennaRNA vrna_mfe_exterior_f5)
  for (let j = 1; j <= n; j++) {
    f5[j] = f5[j - 1] ?? 0; // j unpaired

    // (k,j) forms a base pair
    for (let k = 1; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
      const pairType = fc.pairType(k, j);
      if (isClosingPairAllowed(pairType, fc)) {
        const ckj = safeGet2D(c, k, j, INF);
        if (ckj < INF) {
          // Get neighbor bases for exterior stem energy
          const n5d = k > 1 ? safeGet(fc.encodedSeq, k - 1, 0) : -1;
          const n3d = j < n ? safeGet(fc.encodedSeq, j + 1, 0) : -1;

          // Use exterior stem energy function (mimics ViennaRNA)
          const contrib = ckj + exteriorStemEnergy(pairType, n5d, n3d, dangles);

          if (k === 1) {
            f5[j] = Math.min(f5[j] ?? INF, contrib);
          } else {
            const f5k1 = f5[k - 1] ?? 0;
            f5[j] = Math.min(f5[j] ?? INF, f5k1 + contrib);
          }
        }
      }
    }
  }
}

/**
 * Backtrack to find the optimal structure
 */
function backtrack(fc: FoldCompound): Array<[number, number]> {
  const n = fc.length;
  const { c, fML, f5 } = fc.matrices;
  const { dangles, noLP } = fc.options;
  const basePairs: Array<[number, number]> = [];

  // Stack for backtracking: [i, j, type]
  // type: 0 = external, 1 = paired (c), 2 = multibranch (fML)
  const stack: Array<[number, number, number]> = [];

  // Start from f5[n]
  // ViennaRNA backtracking: first nibble off unpaired 3' bases, then look for pairs
  let j = n;
  while (j > 0) {
    const f5j = f5[j] ?? 0;
    const f5j1 = f5[j - 1] ?? 0;

    // First check if j is unpaired (f5[j] == f5[j-1])
    // ViennaRNA nibbles off unpaired bases first
    if (f5j === f5j1) {
      j--;
      continue;
    }

    // j is paired - find the pairing partner
    // ViennaRNA checks from k = j-1 down to k = 1 (prefer larger k)
    let found = false;
    for (let k = j - MIN_HAIRPIN_SIZE - 1; k >= 1 && !found; k--) {
      const pairType = fc.pairType(k, j);
      if (isClosingPairAllowed(pairType, fc)) {
        const ckj = safeGet2D(c, k, j, INF);
        if (ckj < INF) {
          // Use same exterior stem energy calculation as in fillMatrices
          const n5d = k > 1 ? safeGet(fc.encodedSeq, k - 1, 0) : -1;
          const n3d = j < n ? safeGet(fc.encodedSeq, j + 1, 0) : -1;
          const contrib = ckj + exteriorStemEnergy(pairType, n5d, n3d, dangles);

          const expected = (k === 1) ? contrib : (f5[k - 1] ?? 0) + contrib;
          if (Math.abs(f5j - expected) < 1) {
            basePairs.push([k, j]);
            stack.push([k, j, 1]);
            j = k - 1;
            found = true;
          }
        }
      }
    }
    if (!found) {
      // Should not happen if DP is correct, but handle gracefully
      j--;
    }
  }

  // Process stack
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    const [i, curJ, type] = item;

    if (type === 1) {
      // Paired region (c matrix)
      const cij = safeGet2D(c, i, curJ, INF);
      const pairType = fc.pairType(i, curJ);

      // Check hairpin
      const hairpinE = hairpinEnergy(fc, i, curJ);
      if (Math.abs(cij - hairpinE) < 1) {
        continue; // Hairpin, no more pairs inside
      }

      // Check stacking first (no loop size limit)
      let found = false;
      {
        const p = i + 1;
        const q = curJ - 1;
        if (q > p + MIN_HAIRPIN_SIZE && isPairAllowed(fc.pairType(p, q), fc)) {
          const cpq = safeGet2D(c, p, q, INF);
          if (cpq < INF) {
            const stackE = interiorEnergy(fc, i, curJ, p, q) + cpq;
            if (Math.abs(cij - stackE) < 1) {
              basePairs.push([p, q]);
              stack.push([p, q, 1]);
              found = true;
            }
          }
        }
      }

      // Check interior loops (bulge and internal, limited by maxLoopSize)
      if (!found) {
        const maxLoopSize = 30;
        for (let p = i + 1; p <= Math.min(i + maxLoopSize + 1, curJ - MIN_HAIRPIN_SIZE - 2) && !found; p++) {
          const maxQ = Math.min(curJ - 1, p + maxLoopSize + 1 - (p - i - 1));
          for (let q = Math.max(p + MIN_HAIRPIN_SIZE + 1, curJ - maxLoopSize - 1 + (p - i - 1)); q <= maxQ && !found; q++) {
            // Skip stacking case (already handled above)
            if (p === i + 1 && q === curJ - 1) continue;

            if (isPairAllowed(fc.pairType(p, q), fc)) {
              const cpq = safeGet2D(c, p, q, INF);
              if (cpq < INF) {
                if (noLP) {
                  const n1 = p - i - 1;
                  const n2 = curJ - q - 1;
                  if (!(n1 === 0 && n2 === 0)) continue;
                }
                const interior = interiorEnergy(fc, i, curJ, p, q) + cpq;
                if (Math.abs(cij - interior) < 1) {
                  basePairs.push([p, q]);
                  stack.push([p, q, 1]);
                  found = true;
                }
              }
            }
          }
        }
      }

      if (found) continue;

      // Check multi-loop
      for (let k = i + MIN_HAIRPIN_SIZE + 2; k < curJ - MIN_HAIRPIN_SIZE - 1; k++) {
        const left = safeGet2D(fML, i + 1, k, INF);
        const right = safeGet2D(fML, k + 1, curJ - 1, INF);
        if (left < INF && right < INF) {
          const si1 = safeGet(fc.encodedSeq, i + 1, 0);
          const sj1 = safeGet(fc.encodedSeq, curJ - 1, 0);
          let mlClose = left + right + ML_closing37 + ML_intern37 + terminalPenalty(pairType);

          if (dangles === 2) {
            mlClose += safeGet3D(mismatchM37, pairType, si1, sj1, 0);
          }

          if (Math.abs(cij - mlClose) < 1) {
            stack.push([i + 1, k, 2]);
            stack.push([k + 1, curJ - 1, 2]);
            break;
          }
        }
      }
    } else if (type === 2) {
      // Multibranch loop component (fML matrix)
      if (i >= curJ) continue;

      const fMLij = safeGet2D(fML, i, curJ, INF);
      const fMLij1 = safeGet2D(fML, i, curJ - 1, INF);

      // Check if j is unpaired
      if (fMLij1 < INF && Math.abs(fMLij1 + ML_BASE37 - fMLij) < 1) {
        stack.push([i, curJ - 1, 2]);
        continue;
      }

      // Check for stem at (k,curJ)
      for (let k = i; k <= curJ - MIN_HAIRPIN_SIZE - 1; k++) {
        const stemPairType = fc.pairType(k, curJ);
        if (isPairAllowed(stemPairType, fc)) {
          const ckj = safeGet2D(c, k, curJ, INF);
          if (ckj < INF) {
            let stemContrib = ckj + ML_intern37 + terminalPenalty(stemPairType);

            // Add mismatch/dangle energies for dangles mode (following ViennaRNA E_MLstem)
            if (dangles === 2) {
              const n5d = k > 1 ? safeGet(fc.encodedSeq, k - 1, 0) : -1;
              const n3d = curJ < fc.length ? safeGet(fc.encodedSeq, curJ + 1, 0) : -1;
              if (n5d >= 0 && n3d >= 0) {
                // Both neighbors available - use mismatchM
                stemContrib += safeGet3D(mismatchM37, stemPairType, n5d, n3d, 0);
              } else if (n5d >= 0) {
                stemContrib += safeGet2D(dangle5_37, stemPairType, n5d, 0);
              } else if (n3d >= 0) {
                stemContrib += safeGet2D(dangle3_37, stemPairType, n3d, 0);
              }
            }

            let expected: number;
            if (k === i) {
              expected = stemContrib;
            } else {
              const fMLik1 = safeGet2D(fML, i, k - 1, INF);
              expected = fMLik1 < INF ? fMLik1 + stemContrib : INF;
            }

            if (expected < INF && Math.abs(fMLij - expected) < 1) {
              basePairs.push([k, curJ]);
              stack.push([k, curJ, 1]);
              if (k > i) {
                stack.push([i, k - 1, 2]);
              }
              break;
            }
          }
        }
      }
    }
  }

  return basePairs;
}

/**
 * Convert base pairs to dot-bracket notation
 */
function pairsToDotBracket(length: number, pairs: Array<[number, number]>): string {
  const structure = Array(length).fill('.');

  for (const [i, curJ] of pairs) {
    structure[i - 1] = '(';
    structure[curJ - 1] = ')';
  }

  return structure.join('');
}

/**
 * Main folding function
 * Predicts the minimum free energy secondary structure of an RNA sequence
 */
export function fold(sequence: string, options: FoldOptions = {}): FoldResult {
  // Clean and validate sequence
  const cleanedSequence = cleanSequence(sequence);

  if (cleanedSequence.length === 0) {
    throw new Error('Empty sequence provided');
  }

  if (cleanedSequence.length < MIN_HAIRPIN_SIZE + 2) {
    // Too short to form any structure
    return {
      sequence: cleanedSequence,
      structure: '.'.repeat(cleanedSequence.length),
      mfe: 0,
      basePairs: []
    };
  }

  // Create fold compound and fill matrices
  const fc = createFoldCompound(cleanedSequence, options);
  fillMatrices(fc);

  // Get MFE (convert from centidecimal to kcal/mol)
  const mfe = (fc.matrices.f5[fc.length] ?? 0) / 100;

  // Backtrack to get structure
  const basePairs = backtrack(fc);

  // Sort base pairs by first position
  basePairs.sort((a, b) => a[0] - b[0]);

  // Convert to dot-bracket
  const structure = pairsToDotBracket(fc.length, basePairs);

  return {
    sequence: cleanedSequence,
    structure,
    mfe,
    basePairs
  };
}

// Re-export types
export { isValidSequence, cleanSequence } from './sequence';

/**
 * Debug function to expose internal matrices
 */
export function foldDebug(sequence: string, options: FoldOptions = {}) {
  const cleanedSequence = cleanSequence(sequence);
  const fc = createFoldCompound(cleanedSequence, options);
  fillMatrices(fc);
  return {
    f5: fc.matrices.f5,
    c: fc.matrices.c,
    fML: fc.matrices.fML,
    encodedSeq: fc.encodedSeq,
    length: fc.length
  };
}
