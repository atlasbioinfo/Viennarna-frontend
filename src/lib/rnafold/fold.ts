/**
 * RNA Secondary Structure Prediction using Minimum Free Energy (MFE)
 * Implementation based on Zuker algorithm and ViennaRNA package
 */

import { INF, MIN_HAIRPIN_SIZE, PairType, type PairTypeValue } from './constants';
import {
  stack37,
  hairpin37,
  bulge37,
  internalLoop37,
  mismatchH37,
  mismatchI37,
  mismatchM37,
  dangle5_37,
  dangle3_37,
  TerminalAU,
  ML_intern,
  ML_closing,
  ML_BASE,
  MAX_NINIO,
  ninio37,
  loopEnergy,
  Tetraloops,
  Triloops,
  Hexaloops,
} from './energyParams';
import { encodeSequence, getPairType, isAUorGU, cleanSequence } from './sequence';

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
}

// Safe array access helper
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

/**
 * Get terminal AU/GU penalty
 */
function terminalPenalty(pairType: PairTypeValue): number {
  return isAUorGU(pairType) ? TerminalAU : 0;
}

/**
 * Calculate hairpin loop energy
 */
function hairpinEnergy(
  fc: FoldCompound,
  i: number,
  j: number
): number {
  const size = j - i - 1;
  const pairType = fc.pairType(i, j);

  if (size < MIN_HAIRPIN_SIZE) return INF;
  if (pairType === PairType.NONE) return INF;

  let energy = loopEnergy(size, hairpin37);

  // Add mismatch energy for size >= 3
  if (size >= 3) {
    const si1 = safeGet(fc.encodedSeq, i + 1, 0);
    const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
    energy += safeGet3D(mismatchH37, pairType, si1, sj1, 0);
  }

  // Terminal AU/GU penalty
  energy += terminalPenalty(pairType);

  // Check for special loops (tetraloops, triloops, hexaloops)
  if (size === 4) {
    const loopSeq = fc.sequence.substring(i - 1, j);
    for (const tl of Tetraloops) {
      if (loopSeq === tl.seq) {
        energy += tl.energy;
        break;
      }
    }
  } else if (size === 3) {
    const loopSeq = fc.sequence.substring(i - 1, j);
    for (const tl of Triloops) {
      if (loopSeq === tl.seq) {
        energy += tl.energy;
        break;
      }
    }
  } else if (size === 6) {
    const loopSeq = fc.sequence.substring(i - 1, j);
    for (const hl of Hexaloops) {
      if (loopSeq === hl.seq) {
        energy += hl.energy;
        break;
      }
    }
  }

  return energy;
}

/**
 * Calculate interior loop energy (including bulges and internal loops)
 */
function interiorEnergy(
  fc: FoldCompound,
  i: number,
  j: number,
  p: number,
  q: number
): number {
  const pairType_ij = fc.pairType(i, j);
  const pairType_pq = fc.pairType(p, q);

  if (pairType_ij === PairType.NONE || pairType_pq === PairType.NONE) {
    return INF;
  }

  const n1 = p - i - 1; // 5' side unpaired
  const n2 = j - q - 1; // 3' side unpaired

  if (n1 === 0 && n2 === 0) {
    // Stacking - no loop, just stacked pairs
    return safeGet2D(stack37, pairType_ij, pairType_pq, INF);
  }

  if (n1 === 0 || n2 === 0) {
    // Bulge loop
    const size = n1 + n2;
    let energy = loopEnergy(size, bulge37);

    if (size === 1) {
      // Special case: 1-nucleotide bulge, add stacking
      energy += safeGet2D(stack37, pairType_ij, pairType_pq, 0);
    } else {
      // Terminal AU/GU penalties
      energy += terminalPenalty(pairType_ij);
      energy += terminalPenalty(pairType_pq);
    }

    return energy;
  }

  // Internal loop
  const size = n1 + n2;
  let energy: number;

  const si1 = safeGet(fc.encodedSeq, i + 1, 0);
  const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
  const sq1 = safeGet(fc.encodedSeq, q + 1, 0);
  const sp1 = safeGet(fc.encodedSeq, p - 1, 0);

  if (n1 === 1 && n2 === 1) {
    // 1x1 internal loop
    energy = loopEnergy(2, internalLoop37);
    energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);
  } else if (n1 === 1 || n2 === 1) {
    // 1xn or nx1 internal loop
    energy = loopEnergy(size, internalLoop37);
    // Ninio asymmetry penalty
    const asymmetry = Math.abs(n1 - n2);
    energy += Math.min(MAX_NINIO, asymmetry * ninio37);
    energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);
  } else if (n1 === 2 && n2 === 2) {
    // 2x2 internal loop
    energy = loopEnergy(4, internalLoop37);
    energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);
  } else {
    // General internal loop
    energy = loopEnergy(size, internalLoop37);
    // Ninio asymmetry penalty
    const asymmetry = Math.abs(n1 - n2);
    energy += Math.min(MAX_NINIO, asymmetry * ninio37);
    // Mismatch energies
    energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);
  }

  return energy;
}

/**
 * Initialize fold compound
 */
function createFoldCompound(sequence: string): FoldCompound {
  const cleanedSeq = cleanSequence(sequence);
  const encodedSeq = encodeSequence(cleanedSeq);
  const n = cleanedSeq.length;

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
    matrices: { c, fML, f5 }
  };

  return fc;
}

/**
 * Fill the DP matrices
 */
function fillMatrices(fc: FoldCompound): void {
  const n = fc.length;
  const { c, fML, f5 } = fc.matrices;

  // Fill matrices for increasing subsequence lengths
  for (let d = MIN_HAIRPIN_SIZE + 1; d <= n; d++) {
    for (let i = 1; i <= n - d; i++) {
      const j = i + d;

      // Check if (i,j) can form a base pair
      const pairType = fc.pairType(i, j);

      if (pairType !== PairType.NONE) {
        // Case 1: Hairpin loop
        let cij = hairpinEnergy(fc, i, j);

        // Case 2: Interior loop (including stacking and bulge)
        for (let p = i + 1; p <= Math.min(i + 30, j - MIN_HAIRPIN_SIZE - 2); p++) {
          const maxQ = Math.min(j - 1, p + 30 - (p - i - 1));
          for (let q = Math.max(p + MIN_HAIRPIN_SIZE + 1, j - 30 + (p - i - 1)); q <= maxQ; q++) {
            if (fc.pairType(p, q) !== PairType.NONE) {
              const cpq = safeGet2D(c, p, q, INF);
              if (cpq < INF) {
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
          const mlClose = mlEnergy + ML_closing + ML_intern +
            safeGet3D(mismatchM37, pairType, si1, sj1, 0) + terminalPenalty(pairType);
          cij = Math.min(cij, mlClose);
        }

        const cRow = c[i];
        if (cRow) cRow[j] = cij;
      }

      // Fill fML[i][j] - multibranch loop component
      let fMLij = safeGet2D(fML, i, j - 1, INF);
      if (fMLij < INF) {
        fMLij += ML_BASE;
      }

      // Case 2: (k,j) forms a stem
      for (let k = i; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
        if (fc.pairType(k, j) !== PairType.NONE) {
          const ckj = safeGet2D(c, k, j, INF);
          if (ckj < INF) {
            const stemContrib = ckj + ML_intern + terminalPenalty(fc.pairType(k, j));
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

  // Fill f5 - external loop energy
  for (let j = 1; j <= n; j++) {
    f5[j] = f5[j - 1] ?? 0; // j unpaired

    // (k,j) forms a base pair
    for (let k = 1; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
      if (fc.pairType(k, j) !== PairType.NONE) {
        const ckj = safeGet2D(c, k, j, INF);
        if (ckj < INF) {
          const pairType = fc.pairType(k, j);
          let contrib = ckj + terminalPenalty(pairType);

          // Add dangling ends for external loop
          if (k > 1) {
            const sk1 = safeGet(fc.encodedSeq, k - 1, 0);
            contrib += safeGet2D(dangle5_37, pairType, sk1, 0);
          }
          if (j < n) {
            const sj1 = safeGet(fc.encodedSeq, j + 1, 0);
            contrib += safeGet2D(dangle3_37, pairType, sj1, 0);
          }

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
  const basePairs: Array<[number, number]> = [];

  // Stack for backtracking: [i, j, type]
  // type: 0 = external, 1 = paired (c), 2 = multibranch (fML)
  const stack: Array<[number, number, number]> = [];

  // Start from f5[n]
  let j = n;
  while (j > 0) {
    const f5j = f5[j] ?? 0;
    const f5j1 = f5[j - 1] ?? 0;

    if (f5j === f5j1) {
      // j is unpaired
      j--;
    } else {
      // Find k such that (k,j) is paired
      let found = false;
      for (let k = 1; k <= j - MIN_HAIRPIN_SIZE - 1 && !found; k++) {
        if (fc.pairType(k, j) !== PairType.NONE) {
          const ckj = safeGet2D(c, k, j, INF);
          if (ckj < INF) {
            const pairType = fc.pairType(k, j);
            let contrib = ckj + terminalPenalty(pairType);

            if (k > 1) {
              const sk1 = safeGet(fc.encodedSeq, k - 1, 0);
              contrib += safeGet2D(dangle5_37, pairType, sk1, 0);
            }
            if (j < n) {
              const sj1 = safeGet(fc.encodedSeq, j + 1, 0);
              contrib += safeGet2D(dangle3_37, pairType, sj1, 0);
            }

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
      if (!found) j--;
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
      if (cij === hairpinEnergy(fc, i, curJ)) {
        continue; // Hairpin, no more pairs inside
      }

      // Check interior loops
      let found = false;
      for (let p = i + 1; p <= Math.min(i + 30, curJ - MIN_HAIRPIN_SIZE - 2) && !found; p++) {
        const maxQ = Math.min(curJ - 1, p + 30 - (p - i - 1));
        for (let q = Math.max(p + MIN_HAIRPIN_SIZE + 1, curJ - 30 + (p - i - 1)); q <= maxQ && !found; q++) {
          if (fc.pairType(p, q) !== PairType.NONE) {
            const cpq = safeGet2D(c, p, q, INF);
            if (cpq < INF) {
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

      if (found) continue;

      // Check multi-loop
      for (let k = i + MIN_HAIRPIN_SIZE + 2; k < curJ - MIN_HAIRPIN_SIZE - 1; k++) {
        const left = safeGet2D(fML, i + 1, k, INF);
        const right = safeGet2D(fML, k + 1, curJ - 1, INF);
        if (left < INF && right < INF) {
          const si1 = safeGet(fc.encodedSeq, i + 1, 0);
          const sj1 = safeGet(fc.encodedSeq, curJ - 1, 0);
          const mlClose = left + right + ML_closing + ML_intern +
            safeGet3D(mismatchM37, pairType, si1, sj1, 0) + terminalPenalty(pairType);

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
      if (fMLij1 < INF && fMLij1 + ML_BASE === fMLij) {
        stack.push([i, curJ - 1, 2]);
        continue;
      }

      // Check for stem at (k,j)
      for (let k = i; k <= curJ - MIN_HAIRPIN_SIZE - 1; k++) {
        if (fc.pairType(k, curJ) !== PairType.NONE) {
          const ckj = safeGet2D(c, k, curJ, INF);
          if (ckj < INF) {
            const stemContrib = ckj + ML_intern + terminalPenalty(fc.pairType(k, curJ));
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
export function fold(sequence: string): FoldResult {
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
  const fc = createFoldCompound(cleanedSequence);
  fillMatrices(fc);

  // Get MFE (convert from centidecimal to kcal/mol)
  const mfe = (fc.matrices.f5[fc.length] ?? 0) / 100;

  // Backtrack to get structure
  const basePairs = backtrack(fc);

  // Convert to dot-bracket
  const structure = pairsToDotBracket(fc.length, basePairs);

  return {
    sequence: cleanedSequence,
    structure,
    mfe,
    basePairs
  };
}

/**
 * Evaluate the free energy of a given structure
 */
export function evalStructure(sequence: string, structure: string): number {
  const cleanedSequence = cleanSequence(sequence);

  if (cleanedSequence.length !== structure.length) {
    throw new Error('Sequence and structure must have the same length');
  }

  // Parse structure to get base pairs
  const pairs: Array<[number, number]> = [];
  const parenStack: number[] = [];

  for (let i = 0; i < structure.length; i++) {
    if (structure[i] === '(') {
      parenStack.push(i + 1); // 1-indexed
    } else if (structure[i] === ')') {
      if (parenStack.length === 0) {
        throw new Error('Unbalanced structure: too many closing brackets');
      }
      const openIdx = parenStack.pop()!;
      pairs.push([openIdx, i + 1]);
    }
  }

  if (parenStack.length > 0) {
    throw new Error('Unbalanced structure: too many opening brackets');
  }

  // Create fold compound
  const fc = createFoldCompound(cleanedSequence);
  const encodedSeq = fc.encodedSeq;

  // Calculate energy
  let energy = 0;

  // Sort pairs by closing position for proper evaluation
  pairs.sort((a, b) => a[1] - b[1]);

  // Build pair table
  const pairTable: number[] = Array(cleanedSequence.length + 1).fill(0);
  for (const [i, curJ] of pairs) {
    pairTable[i] = curJ;
    pairTable[curJ] = i;
  }

  // Evaluate each loop
  for (const [i, curJ] of pairs) {
    const bi = safeGet(encodedSeq, i, 0);
    const bj = safeGet(encodedSeq, curJ, 0);
    const pairType = getPairType(bi, bj);

    if (pairType === PairType.NONE) {
      throw new Error(`Invalid base pair at positions ${i} and ${curJ}`);
    }

    // Check what's inside this pair
    let k = i + 1;
    const innerPairs: Array<[number, number]> = [];

    while (k < curJ) {
      const pk = pairTable[k] ?? 0;
      if (pk > k && pk < curJ) {
        innerPairs.push([k, pk]);
        k = pk + 1;
      } else {
        k++;
      }
    }

    if (innerPairs.length === 0) {
      // Hairpin loop
      energy += hairpinEnergy(fc, i, curJ);
    } else if (innerPairs.length === 1) {
      // Interior loop (including stacking and bulge)
      const firstPair = innerPairs[0];
      if (firstPair) {
        const [p, q] = firstPair;
        energy += interiorEnergy(fc, i, curJ, p, q);
      }
    } else {
      // Multi-loop
      energy += ML_closing;

      for (const [p, q] of innerPairs) {
        const bp = safeGet(encodedSeq, p, 0);
        const bq = safeGet(encodedSeq, q, 0);
        const innerPairType = getPairType(bp, bq);
        energy += ML_intern + terminalPenalty(innerPairType);
      }

      // Mismatch at closing pair
      const si1 = safeGet(encodedSeq, i + 1, 0);
      const sj1 = safeGet(encodedSeq, curJ - 1, 0);
      energy += safeGet3D(mismatchM37, pairType, si1, sj1, 0) + terminalPenalty(pairType);

      // Unpaired bases
      let unpaired = curJ - i - 1;
      for (const [p, q] of innerPairs) {
        unpaired -= (q - p + 1);
      }
      energy += unpaired * ML_BASE;
    }
  }

  // External loop contributions (dangling ends for base pairs)
  for (const [i, curJ] of pairs) {
    const bi = safeGet(encodedSeq, i, 0);
    const bj = safeGet(encodedSeq, curJ, 0);
    const pairType = getPairType(bi, bj);

    // Only count for outermost pairs
    if (i > 1 && (pairTable[i - 1] ?? 0) === 0) {
      const sk1 = safeGet(encodedSeq, i - 1, 0);
      energy += safeGet2D(dangle5_37, pairType, sk1, 0);
    }
    if (curJ < cleanedSequence.length && (pairTable[curJ + 1] ?? 0) === 0) {
      const sj1 = safeGet(encodedSeq, curJ + 1, 0);
      energy += safeGet2D(dangle3_37, pairType, sj1, 0);
    }
  }

  return energy / 100; // Convert from centidecimal to kcal/mol
}
