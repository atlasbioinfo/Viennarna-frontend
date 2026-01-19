/**
 * RNAcofold TypeScript Implementation
 * Based on ViennaRNA Package
 *
 * Predicts the minimum free energy secondary structure of two interacting
 * RNA molecules (cofolding). The sequences are concatenated with a '&'
 * separator and both intra- and inter-molecular base pairs are considered.
 */

import { INF, MIN_HAIRPIN_SIZE, PairType, type PairTypeValue } from '../rnafold/constants';
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
} from '../rnafold/energyParams';
import { encodeSequence, getPairType, isAUorGU, cleanSequence } from '../rnafold/sequence';

/**
 * Result of RNA cofolding
 */
export interface CofoldResult {
  sequenceA: string;
  sequenceB: string;
  combinedSequence: string;
  structure: string;
  structureA: string;  // Structure of first sequence
  structureB: string;  // Structure of second sequence
  mfe: number;         // Total MFE
  intraMfeA: number;   // Intramolecular MFE of sequence A alone
  intraMfeB: number;   // Intramolecular MFE of sequence B alone
  interactionEnergy: number;  // Energy from intermolecular interactions
  basePairs: Array<[number, number]>;
  interMolecularPairs: Array<[number, number]>;  // Pairs between A and B
  intraMolecularPairsA: Array<[number, number]>; // Pairs within A
  intraMolecularPairsB: Array<[number, number]>; // Pairs within B
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

function terminalPenalty(pairType: PairTypeValue): number {
  return isAUorGU(pairType) ? TerminalAU : 0;
}

/**
 * Cofold compound
 */
interface CofoldCompound {
  sequenceA: string;
  sequenceB: string;
  combinedSeq: string;
  encodedSeq: number[];
  length: number;
  cutPoint: number;  // Position where sequence B starts (1-indexed)
  pairType: (i: number, j: number) => PairTypeValue;
  isInterMolecular: (i: number, j: number) => boolean;
}

function createCofoldCompound(seqA: string, seqB: string): CofoldCompound {
  const cleanA = cleanSequence(seqA);
  const cleanB = cleanSequence(seqB);
  const combinedSeq = cleanA + cleanB;
  const encodedSeq = encodeSequence(combinedSeq);
  const cutPoint = cleanA.length + 1;

  return {
    sequenceA: cleanA,
    sequenceB: cleanB,
    combinedSeq,
    encodedSeq,
    length: combinedSeq.length,
    cutPoint,
    pairType: (i, j) => {
      const bi = safeGet(encodedSeq, i, 0);
      const bj = safeGet(encodedSeq, j, 0);
      return getPairType(bi, bj);
    },
    isInterMolecular: (i, j) => {
      // Returns true if one position is in A and the other in B
      const iInA = i < cutPoint;
      const jInA = j < cutPoint;
      return iInA !== jInA;
    }
  };
}

/**
 * Calculate hairpin loop energy
 * Note: Hairpins that span the cut point are not allowed
 */
function hairpinEnergy(fc: CofoldCompound, i: number, j: number): number {
  const size = j - i - 1;
  const pairType = fc.pairType(i, j);

  if (size < MIN_HAIRPIN_SIZE) return INF;
  if (pairType === PairType.NONE) return INF;

  // Hairpin cannot span cut point (would mean unpaired region crosses molecules)
  if (i < fc.cutPoint && j >= fc.cutPoint) {
    // The loop region (i+1 to j-1) spans the cut point
    // This is only valid if there are no unpaired bases from the cut
    if (i + 1 < fc.cutPoint && fc.cutPoint < j) {
      return INF;
    }
  }

  let energy = loopEnergy(size, hairpin37);

  if (size >= 3) {
    const si1 = safeGet(fc.encodedSeq, i + 1, 0);
    const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
    energy += safeGet3D(mismatchH37, pairType, si1, sj1, 0);
  }

  energy += terminalPenalty(pairType);

  // Special loops (only if entirely within one molecule)
  if (!fc.isInterMolecular(i, j)) {
    const loopSeq = fc.combinedSeq.substring(i - 1, j);
    if (size === 4) {
      for (const tl of Tetraloops) {
        if (loopSeq === tl.seq) {
          energy += tl.energy;
          break;
        }
      }
    } else if (size === 3) {
      for (const tl of Triloops) {
        if (loopSeq === tl.seq) {
          energy += tl.energy;
          break;
        }
      }
    } else if (size === 6) {
      for (const hl of Hexaloops) {
        if (loopSeq === hl.seq) {
          energy += hl.energy;
          break;
        }
      }
    }
  }

  return energy;
}

/**
 * Calculate interior loop energy
 */
function interiorEnergy(
  fc: CofoldCompound,
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

  const n1 = p - i - 1;
  const n2 = j - q - 1;

  // Check if loop spans cut point inappropriately
  const cutPoint = fc.cutPoint;
  // 5' side: positions i+1 to p-1
  // 3' side: positions q+1 to j-1
  const side5CrossesCut = (i + 1 < cutPoint && p - 1 >= cutPoint);
  const side3CrossesCut = (q + 1 < cutPoint && j - 1 >= cutPoint);

  if (side5CrossesCut || side3CrossesCut) {
    return INF;
  }

  if (n1 === 0 && n2 === 0) {
    return safeGet2D(stack37, pairType_ij, pairType_pq, INF);
  }

  if (n1 === 0 || n2 === 0) {
    const size = n1 + n2;
    let energy = loopEnergy(size, bulge37);
    if (size === 1) {
      energy += safeGet2D(stack37, pairType_ij, pairType_pq, 0);
    } else {
      energy += terminalPenalty(pairType_ij);
      energy += terminalPenalty(pairType_pq);
    }
    return energy;
  }

  const size = n1 + n2;
  let energy = loopEnergy(size, internalLoop37);

  const asymmetry = Math.abs(n1 - n2);
  energy += Math.min(MAX_NINIO, asymmetry * ninio37);

  const si1 = safeGet(fc.encodedSeq, i + 1, 0);
  const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
  const sq1 = safeGet(fc.encodedSeq, q + 1, 0);
  const sp1 = safeGet(fc.encodedSeq, p - 1, 0);

  energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
  energy += safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);

  return energy;
}

/**
 * Fill DP matrices for cofolding
 */
function fillMatrices(fc: CofoldCompound): {
  c: number[][];
  fML: number[][];
  f5: number[];
} {
  const n = fc.length;
  const c: number[][] = Array(n + 1).fill(null).map(() => Array(n + 1).fill(INF));
  const fML: number[][] = Array(n + 1).fill(null).map(() => Array(n + 1).fill(INF));
  const f5: number[] = Array(n + 1).fill(0);

  for (let d = MIN_HAIRPIN_SIZE + 1; d <= n; d++) {
    for (let i = 1; i <= n - d; i++) {
      const j = i + d;
      const pairType = fc.pairType(i, j);

      if (pairType !== PairType.NONE) {
        let cij = hairpinEnergy(fc, i, j);

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

      let fMLij = safeGet2D(fML, i, j - 1, INF);
      if (fMLij < INF) {
        fMLij += ML_BASE;
      }

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

  for (let j = 1; j <= n; j++) {
    f5[j] = f5[j - 1] ?? 0;

    for (let k = 1; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
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

  return { c, fML, f5 };
}

/**
 * Backtrack to find base pairs
 */
function backtrack(
  fc: CofoldCompound,
  c: number[][],
  fML: number[][],
  f5: number[]
): Array<[number, number]> {
  const n = fc.length;
  const basePairs: Array<[number, number]> = [];

  const stack: Array<[number, number, number]> = [];

  let j = n;
  while (j > 0) {
    const f5j = f5[j] ?? 0;
    const f5j1 = f5[j - 1] ?? 0;

    if (f5j === f5j1) {
      j--;
    } else {
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

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    const [i, curJ, type] = item;

    if (type === 1) {
      const cij = safeGet2D(c, i, curJ, INF);
      const pairType = fc.pairType(i, curJ);

      if (cij === hairpinEnergy(fc, i, curJ)) {
        continue;
      }

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
      if (i >= curJ) continue;

      const fMLij = safeGet2D(fML, i, curJ, INF);
      const fMLij1 = safeGet2D(fML, i, curJ - 1, INF);

      if (fMLij1 < INF && fMLij1 + ML_BASE === fMLij) {
        stack.push([i, curJ - 1, 2]);
        continue;
      }

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
 * Convert base pairs to dot-bracket with '&' separator
 */
function pairsToDotBracket(
  lenA: number,
  lenB: number,
  pairs: Array<[number, number]>
): { full: string; structA: string; structB: string } {
  const total = lenA + lenB;
  const structure = Array(total).fill('.');

  for (const [i, j] of pairs) {
    structure[i - 1] = '(';
    structure[j - 1] = ')';
  }

  const structA = structure.slice(0, lenA).join('');
  const structB = structure.slice(lenA).join('');
  const full = structA + '&' + structB;

  return { full, structA, structB };
}

/**
 * Simple fold for a single sequence (for intramolecular MFE calculation)
 */
function simpleFold(sequence: string): { mfe: number } {
  const cleanedSeq = cleanSequence(sequence);
  if (cleanedSeq.length < MIN_HAIRPIN_SIZE + 2) {
    return { mfe: 0 };
  }

  const encodedSeq = encodeSequence(cleanedSeq);
  const n = cleanedSeq.length;

  const c: number[][] = Array(n + 1).fill(null).map(() => Array(n + 1).fill(INF));
  const fML: number[][] = Array(n + 1).fill(null).map(() => Array(n + 1).fill(INF));
  const f5: number[] = Array(n + 1).fill(0);

  const getPairTypeLocal = (i: number, j: number): PairTypeValue => {
    const bi = safeGet(encodedSeq, i, 0);
    const bj = safeGet(encodedSeq, j, 0);
    return getPairType(bi, bj);
  };

  // Simplified hairpin energy calculation
  const hairpinEnergyLocal = (i: number, j: number): number => {
    const size = j - i - 1;
    const pairType = getPairTypeLocal(i, j);
    if (size < MIN_HAIRPIN_SIZE || pairType === PairType.NONE) return INF;

    let energy = loopEnergy(size, hairpin37);
    if (size >= 3) {
      const si1 = safeGet(encodedSeq, i + 1, 0);
      const sj1 = safeGet(encodedSeq, j - 1, 0);
      energy += safeGet3D(mismatchH37, pairType, si1, sj1, 0);
    }
    energy += terminalPenalty(pairType);
    return energy;
  };

  // Simplified interior energy
  const interiorEnergyLocal = (i: number, j: number, p: number, q: number): number => {
    const pairType_ij = getPairTypeLocal(i, j);
    const pairType_pq = getPairTypeLocal(p, q);
    if (pairType_ij === PairType.NONE || pairType_pq === PairType.NONE) return INF;

    const n1 = p - i - 1;
    const n2 = j - q - 1;

    if (n1 === 0 && n2 === 0) {
      return safeGet2D(stack37, pairType_ij, pairType_pq, INF);
    }

    if (n1 === 0 || n2 === 0) {
      const size = n1 + n2;
      let energy = loopEnergy(size, bulge37);
      if (size === 1) {
        energy += safeGet2D(stack37, pairType_ij, pairType_pq, 0);
      } else {
        energy += terminalPenalty(pairType_ij) + terminalPenalty(pairType_pq);
      }
      return energy;
    }

    const size = n1 + n2;
    let energy = loopEnergy(size, internalLoop37);
    energy += Math.min(MAX_NINIO, Math.abs(n1 - n2) * ninio37);

    const si1 = safeGet(encodedSeq, i + 1, 0);
    const sj1 = safeGet(encodedSeq, j - 1, 0);
    const sq1 = safeGet(encodedSeq, q + 1, 0);
    const sp1 = safeGet(encodedSeq, p - 1, 0);
    energy += safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
    energy += safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);

    return energy;
  };

  for (let d = MIN_HAIRPIN_SIZE + 1; d <= n; d++) {
    for (let i = 1; i <= n - d; i++) {
      const j = i + d;
      const pairType = getPairTypeLocal(i, j);

      if (pairType !== PairType.NONE) {
        let cij = hairpinEnergyLocal(i, j);

        for (let p = i + 1; p <= Math.min(i + 30, j - MIN_HAIRPIN_SIZE - 2); p++) {
          for (let q = Math.max(p + MIN_HAIRPIN_SIZE + 1, j - 30 + (p - i - 1)); q <= Math.min(j - 1, p + 30 - (p - i - 1)); q++) {
            if (getPairTypeLocal(p, q) !== PairType.NONE) {
              const cpq = safeGet2D(c, p, q, INF);
              if (cpq < INF) {
                cij = Math.min(cij, interiorEnergyLocal(i, j, p, q) + cpq);
              }
            }
          }
        }

        let mlEnergy = INF;
        for (let k = i + MIN_HAIRPIN_SIZE + 2; k < j - MIN_HAIRPIN_SIZE - 1; k++) {
          const left = safeGet2D(fML, i + 1, k, INF);
          const right = safeGet2D(fML, k + 1, j - 1, INF);
          if (left < INF && right < INF) {
            mlEnergy = Math.min(mlEnergy, left + right);
          }
        }

        if (mlEnergy < INF) {
          const si1 = safeGet(encodedSeq, i + 1, 0);
          const sj1 = safeGet(encodedSeq, j - 1, 0);
          cij = Math.min(cij, mlEnergy + ML_closing + ML_intern +
            safeGet3D(mismatchM37, pairType, si1, sj1, 0) + terminalPenalty(pairType));
        }

        if (c[i]) c[i]![j] = cij;
      }

      let fMLij = safeGet2D(fML, i, j - 1, INF);
      if (fMLij < INF) fMLij += ML_BASE;

      for (let k = i; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
        if (getPairTypeLocal(k, j) !== PairType.NONE) {
          const ckj = safeGet2D(c, k, j, INF);
          if (ckj < INF) {
            const stemContrib = ckj + ML_intern + terminalPenalty(getPairTypeLocal(k, j));
            if (k === i) {
              fMLij = Math.min(fMLij, stemContrib);
            } else {
              const fMLik1 = safeGet2D(fML, i, k - 1, INF);
              if (fMLik1 < INF) fMLij = Math.min(fMLij, fMLik1 + stemContrib);
            }
          }
        }
      }

      if (fML[i]) fML[i]![j] = fMLij;
    }
  }

  for (let j = 1; j <= n; j++) {
    f5[j] = f5[j - 1] ?? 0;
    for (let k = 1; k <= j - MIN_HAIRPIN_SIZE - 1; k++) {
      if (getPairTypeLocal(k, j) !== PairType.NONE) {
        const ckj = safeGet2D(c, k, j, INF);
        if (ckj < INF) {
          const pairType = getPairTypeLocal(k, j);
          let contrib = ckj + terminalPenalty(pairType);
          if (k > 1) {
            contrib += safeGet2D(dangle5_37, pairType, safeGet(encodedSeq, k - 1, 0), 0);
          }
          if (j < n) {
            contrib += safeGet2D(dangle3_37, pairType, safeGet(encodedSeq, j + 1, 0), 0);
          }
          const prev = k === 1 ? 0 : (f5[k - 1] ?? 0);
          f5[j] = Math.min(f5[j] ?? INF, prev + contrib);
        }
      }
    }
  }

  return { mfe: (f5[n] ?? 0) / 100 };
}

/**
 * Main cofolding function
 */
export function cofold(sequenceA: string, sequenceB: string): CofoldResult {
  const fc = createCofoldCompound(sequenceA, sequenceB);

  if (fc.length === 0) {
    throw new Error('Empty sequences provided');
  }

  // Calculate intramolecular MFE for each sequence alone
  const intraMfeA = simpleFold(fc.sequenceA).mfe;
  const intraMfeB = simpleFold(fc.sequenceB).mfe;

  if (fc.length < MIN_HAIRPIN_SIZE + 2) {
    return {
      sequenceA: fc.sequenceA,
      sequenceB: fc.sequenceB,
      combinedSequence: fc.combinedSeq,
      structure: '.'.repeat(fc.sequenceA.length) + '&' + '.'.repeat(fc.sequenceB.length),
      structureA: '.'.repeat(fc.sequenceA.length),
      structureB: '.'.repeat(fc.sequenceB.length),
      mfe: 0,
      intraMfeA,
      intraMfeB,
      interactionEnergy: 0,
      basePairs: [],
      interMolecularPairs: [],
      intraMolecularPairsA: [],
      intraMolecularPairsB: []
    };
  }

  const { c, fML, f5 } = fillMatrices(fc);
  const mfe = (f5[fc.length] ?? 0) / 100;
  const basePairs = backtrack(fc, c, fML, f5);

  // Separate inter- and intra-molecular pairs
  const interMolecularPairs: Array<[number, number]> = [];
  const intraMolecularPairsA: Array<[number, number]> = [];
  const intraMolecularPairsB: Array<[number, number]> = [];

  for (const [i, j] of basePairs) {
    if (fc.isInterMolecular(i, j)) {
      interMolecularPairs.push([i, j]);
    } else if (j < fc.cutPoint) {
      intraMolecularPairsA.push([i, j]);
    } else {
      // Convert to B-relative positions
      intraMolecularPairsB.push([i - fc.cutPoint + 1, j - fc.cutPoint + 1]);
    }
  }

  // Calculate interaction energy (difference from sum of individual folding)
  const interactionEnergy = mfe - intraMfeA - intraMfeB;

  const { full, structA, structB } = pairsToDotBracket(
    fc.sequenceA.length,
    fc.sequenceB.length,
    basePairs
  );

  return {
    sequenceA: fc.sequenceA,
    sequenceB: fc.sequenceB,
    combinedSequence: fc.combinedSeq,
    structure: full,
    structureA: structA,
    structureB: structB,
    mfe,
    intraMfeA,
    intraMfeB,
    interactionEnergy,
    basePairs,
    interMolecularPairs,
    intraMolecularPairsA,
    intraMolecularPairsB
  };
}

/**
 * Format cofold result as string
 */
export function formatResult(result: CofoldResult): string {
  const lines: string[] = [
    `Sequence A: ${result.sequenceA}`,
    `Sequence B: ${result.sequenceB}`,
    ``,
    `Combined: ${result.combinedSequence}`,
    `Structure: ${result.structure}`,
    ``,
    `Energy Summary:`,
    `  Total MFE:          ${result.mfe.toFixed(2)} kcal/mol`,
    `  Intramolecular A:   ${result.intraMfeA.toFixed(2)} kcal/mol`,
    `  Intramolecular B:   ${result.intraMfeB.toFixed(2)} kcal/mol`,
    `  Interaction Energy: ${result.interactionEnergy.toFixed(2)} kcal/mol`,
    ``,
    `Base Pairs:`,
    `  Total: ${result.basePairs.length}`,
    `  Intermolecular: ${result.interMolecularPairs.length}`,
    `  Intramolecular (A): ${result.intraMolecularPairsA.length}`,
    `  Intramolecular (B): ${result.intraMolecularPairsB.length}`,
  ];

  if (result.interMolecularPairs.length > 0) {
    lines.push('');
    lines.push('Intermolecular pairs:');
    for (const [i, j] of result.interMolecularPairs) {
      lines.push(`  ${i} - ${j}`);
    }
  }

  return lines.join('\n');
}
