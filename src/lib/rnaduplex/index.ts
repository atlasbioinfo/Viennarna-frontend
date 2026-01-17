/**
 * RNAduplex TypeScript Implementation
 * Based on ViennaRNA Package
 *
 * Predicts the minimum free energy hybridization structure between two
 * RNA molecules. Only intermolecular base pairs are considered (no
 * intramolecular folding).
 */

import { INF, PairType, type PairTypeValue } from '../rnafold/constants';
import {
  stack37,
  bulge37,
  internalLoop37,
  mismatchI37,
  dangle5_37,
  dangle3_37,
  TerminalAU,
  MAX_NINIO,
  ninio37,
  loopEnergy,
} from '../rnafold/energyParams';
import { encodeSequence, getPairType, isAUorGU, cleanSequence } from '../rnafold/sequence';

/**
 * Result of RNA duplex prediction
 */
export interface DuplexResult {
  sequenceA: string;
  sequenceB: string;
  structureA: string;      // Dot-bracket for sequence A (5' to 3')
  structureB: string;      // Dot-bracket for sequence B (5' to 3')
  energy: number;          // Hybridization energy in kcal/mol
  startA: number;          // Start position in A (1-indexed)
  endA: number;            // End position in A (1-indexed)
  startB: number;          // Start position in B (1-indexed)
  endB: number;            // End position in B (1-indexed)
  basePairs: Array<{ posA: number; posB: number }>;  // Paired positions
}

/**
 * Options for duplex prediction
 */
export interface DuplexOptions {
  maxLoopSize?: number;  // Maximum loop size (default: 30)
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
 * Duplex compound
 */
interface DuplexCompound {
  seqA: string;
  seqB: string;
  encodedA: number[];  // 1-indexed
  encodedB: number[];  // 1-indexed (reversed for antiparallel)
  lenA: number;
  lenB: number;
  pairType: (posA: number, posB: number) => PairTypeValue;
}

function createDuplexCompound(seqA: string, seqB: string): DuplexCompound {
  const cleanA = cleanSequence(seqA);
  const cleanB = cleanSequence(seqB);

  // For duplex, B pairs antiparallel to A
  // A goes 5'->3' (positions 1 to lenA)
  // B goes 3'->5' (we reverse it for pairing: position 1 of B pairs with end of A)
  const encodedA = encodeSequence(cleanA);
  // Reverse B for antiparallel alignment
  const reversedB = cleanB.split('').reverse().join('');
  const encodedB = encodeSequence(reversedB);

  return {
    seqA: cleanA,
    seqB: cleanB,
    encodedA,
    encodedB,
    lenA: cleanA.length,
    lenB: cleanB.length,
    pairType: (posA: number, posB: number) => {
      // posA is position in A (1-indexed)
      // posB is position in reversed B (1-indexed)
      const baseA = safeGet(encodedA, posA, 0);
      const baseB = safeGet(encodedB, posB, 0);
      return getPairType(baseA, baseB);
    }
  };
}

/**
 * Calculate interior loop energy for duplex
 * (i,j) and (p,q) are the closing pairs
 * i < p in sequence A, j > q in reversed sequence B
 */
function duplexInteriorEnergy(
  dc: DuplexCompound,
  i: number,
  j: number,
  p: number,
  q: number
): number {
  const pairType_ij = dc.pairType(i, j);
  const pairType_pq = dc.pairType(p, q);

  if (pairType_ij === PairType.NONE || pairType_pq === PairType.NONE) {
    return INF;
  }

  const n1 = p - i - 1;  // Unpaired in A
  const n2 = j - q - 1;  // Unpaired in B (reversed)

  if (n1 === 0 && n2 === 0) {
    // Stacking
    return safeGet2D(stack37, pairType_ij, pairType_pq, INF);
  }

  if (n1 === 0 || n2 === 0) {
    // Bulge loop
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

  // Internal loop
  const size = n1 + n2;
  let energy = loopEnergy(size, internalLoop37);

  // Ninio asymmetry penalty
  const asymmetry = Math.abs(n1 - n2);
  energy += Math.min(MAX_NINIO, asymmetry * ninio37);

  // Mismatch energies
  const ai1 = safeGet(dc.encodedA, i + 1, 0);
  const bj1 = safeGet(dc.encodedB, j - 1, 0);
  const aq1 = safeGet(dc.encodedA, p - 1, 0);
  const bp1 = safeGet(dc.encodedB, q + 1, 0);

  energy += safeGet3D(mismatchI37, pairType_ij, ai1, bj1, 0);
  energy += safeGet3D(mismatchI37, pairType_pq, bp1, aq1, 0);

  return energy;
}

/**
 * Main duplex prediction using dynamic programming
 */
export function duplex(sequenceA: string, sequenceB: string, options: DuplexOptions = {}): DuplexResult {
  const maxLoopSize = options.maxLoopSize ?? 30;

  const dc = createDuplexCompound(sequenceA, sequenceB);
  const { lenA, lenB } = dc;

  if (lenA === 0 || lenB === 0) {
    throw new Error('Empty sequence provided');
  }

  // c[i][j] = energy of duplex ending with pair (i in A, j in reversed B)
  const c: number[][] = Array(lenA + 1).fill(null).map(() => Array(lenB + 1).fill(INF));

  // Store best structure info
  let bestEnergy = INF;
  let bestI = 0;
  let bestJ = 0;

  // Fill DP matrix
  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const pairType = dc.pairType(i, j);
      if (pairType === PairType.NONE) continue;

      // Initialize with single pair (including terminal penalties and dangles)
      let energy = terminalPenalty(pairType) * 2;  // Both ends are terminal

      // Add 5' dangle on A (position i-1)
      if (i > 1) {
        const d5a = safeGet(dc.encodedA, i - 1, 0);
        energy += safeGet2D(dangle5_37, pairType, d5a, 0);
      }

      // Add 3' dangle on A (none for single pair at position i)

      // Add 5' dangle on B (position j+1 in reversed, which is original 5' end)
      if (j < lenB) {
        const d5b = safeGet(dc.encodedB, j + 1, 0);
        energy += safeGet2D(dangle5_37, pairType, d5b, 0);
      }

      // Stack energy (just the base pair energy)
      energy += safeGet2D(stack37, pairType, pairType, 0) / 2;  // Approximation

      c[i]![j] = energy;

      // Try extending from previous pairs
      for (let p = Math.max(1, i - maxLoopSize - 1); p < i; p++) {
        for (let q = Math.max(1, j - maxLoopSize - 1); q < j; q++) {
          if (dc.pairType(p, q) !== PairType.NONE) {
            const prevEnergy = safeGet2D(c, p, q, INF);
            if (prevEnergy < INF) {
              const loopE = duplexInteriorEnergy(dc, p, q, i, j);
              if (loopE < INF) {
                const newEnergy = prevEnergy + loopE;
                if (newEnergy < c[i]![j]!) {
                  c[i]![j] = newEnergy;
                }
              }
            }
          }
        }
      }

      // Add closing contributions for tracking best
      let closingEnergy = c[i]![j]!;

      // Add 3' dangling ends
      if (i < lenA) {
        const d3a = safeGet(dc.encodedA, i + 1, 0);
        closingEnergy += safeGet2D(dangle3_37, pairType, d3a, 0);
      }
      if (j > 1) {
        const d3b = safeGet(dc.encodedB, j - 1, 0);
        closingEnergy += safeGet2D(dangle3_37, pairType, d3b, 0);
      }

      if (closingEnergy < bestEnergy) {
        bestEnergy = closingEnergy;
        bestI = i;
        bestJ = j;
      }
    }
  }

  // If no valid duplex found
  if (bestEnergy >= INF) {
    return {
      sequenceA: dc.seqA,
      sequenceB: dc.seqB,
      structureA: '.'.repeat(lenA),
      structureB: '.'.repeat(lenB),
      energy: 0,
      startA: 0,
      endA: 0,
      startB: 0,
      endB: 0,
      basePairs: []
    };
  }

  // Backtrack to find base pairs
  const pairs: Array<{ posA: number; posB: number }> = [];

  let curI = bestI;
  let curJ = bestJ;

  while (curI >= 1 && curJ >= 1) {
    const pairType = dc.pairType(curI, curJ);
    if (pairType === PairType.NONE) break;

    // Add this pair
    // posB in original sequence = lenB - curJ + 1 (because B is reversed)
    const origPosB = lenB - curJ + 1;
    pairs.push({ posA: curI, posB: origPosB });

    // Find previous pair
    let foundPrev = false;

    for (let p = curI - 1; p >= Math.max(1, curI - maxLoopSize - 1) && !foundPrev; p--) {
      for (let q = curJ - 1; q >= Math.max(1, curJ - maxLoopSize - 1) && !foundPrev; q--) {
        if (dc.pairType(p, q) !== PairType.NONE) {
          const prevEnergy = safeGet2D(c, p, q, INF);
          if (prevEnergy < INF) {
            const loopE = duplexInteriorEnergy(dc, p, q, curI, curJ);
            if (loopE < INF) {
              const expected = prevEnergy + loopE;
              const curEnergy = safeGet2D(c, curI, curJ, INF);
              if (Math.abs(expected - curEnergy) < 1) {
                curI = p;
                curJ = q;
                foundPrev = true;
              }
            }
          }
        }
      }
    }

    if (!foundPrev) break;
  }

  // Reverse pairs to get 5' to 3' order
  pairs.reverse();

  // Build structures
  const structA = Array(lenA).fill('.');
  const structB = Array(lenB).fill('.');

  for (const pair of pairs) {
    structA[pair.posA - 1] = '(';
    structB[pair.posB - 1] = ')';
  }

  // Find start/end positions
  let startA = lenA + 1, endA = 0;
  let startB = lenB + 1, endB = 0;

  for (const pair of pairs) {
    startA = Math.min(startA, pair.posA);
    endA = Math.max(endA, pair.posA);
    startB = Math.min(startB, pair.posB);
    endB = Math.max(endB, pair.posB);
  }

  return {
    sequenceA: dc.seqA,
    sequenceB: dc.seqB,
    structureA: structA.join(''),
    structureB: structB.join(''),
    energy: bestEnergy / 100,
    startA: pairs.length > 0 ? startA : 0,
    endA: pairs.length > 0 ? endA : 0,
    startB: pairs.length > 0 ? startB : 0,
    endB: pairs.length > 0 ? endB : 0,
    basePairs: pairs
  };
}

/**
 * Find multiple duplex sites (top N)
 */
export function duplexMultiple(
  sequenceA: string,
  sequenceB: string,
  maxResults: number = 5
): DuplexResult[] {
  const results: DuplexResult[] = [];
  const usedRegions = new Set<string>();

  const dc = createDuplexCompound(sequenceA, sequenceB);
  const { lenA, lenB } = dc;

  // Get all possible duplexes with their energies
  const candidates: Array<{ i: number; j: number; energy: number }> = [];

  const c: number[][] = Array(lenA + 1).fill(null).map(() => Array(lenB + 1).fill(INF));

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const pairType = dc.pairType(i, j);
      if (pairType === PairType.NONE) continue;

      let energy = terminalPenalty(pairType) * 2;

      if (i > 1) {
        const d5a = safeGet(dc.encodedA, i - 1, 0);
        energy += safeGet2D(dangle5_37, pairType, d5a, 0);
      }
      if (j < lenB) {
        const d5b = safeGet(dc.encodedB, j + 1, 0);
        energy += safeGet2D(dangle5_37, pairType, d5b, 0);
      }

      c[i]![j] = energy;

      for (let p = Math.max(1, i - 30); p < i; p++) {
        for (let q = Math.max(1, j - 30); q < j; q++) {
          if (dc.pairType(p, q) !== PairType.NONE) {
            const prevEnergy = safeGet2D(c, p, q, INF);
            if (prevEnergy < INF) {
              const loopE = duplexInteriorEnergy(dc, p, q, i, j);
              if (loopE < INF) {
                const newEnergy = prevEnergy + loopE;
                if (newEnergy < c[i]![j]!) {
                  c[i]![j] = newEnergy;
                }
              }
            }
          }
        }
      }

      let closingEnergy = c[i]![j]!;
      if (i < lenA) {
        const d3a = safeGet(dc.encodedA, i + 1, 0);
        closingEnergy += safeGet2D(dangle3_37, pairType, d3a, 0);
      }
      if (j > 1) {
        const d3b = safeGet(dc.encodedB, j - 1, 0);
        closingEnergy += safeGet2D(dangle3_37, pairType, d3b, 0);
      }

      candidates.push({ i, j, energy: closingEnergy });
    }
  }

  // Sort by energy
  candidates.sort((a, b) => a.energy - b.energy);

  // Get non-overlapping results
  for (const cand of candidates) {
    if (results.length >= maxResults) break;

    // Check if this region overlaps with already found
    const key = `${cand.i}-${cand.j}`;
    let overlaps = false;

    for (const used of usedRegions) {
      const [ui, uj] = used.split('-').map(Number);
      // Simple overlap check
      if (Math.abs(cand.i - ui!) < 5 && Math.abs(cand.j - uj!) < 5) {
        overlaps = true;
        break;
      }
    }

    if (!overlaps) {
      // Run full duplex starting from this position
      const result = duplex(sequenceA, sequenceB);
      if (result.basePairs.length > 0) {
        results.push(result);
        usedRegions.add(key);
      }
    }
  }

  return results;
}

/**
 * Format duplex result as string
 */
export function formatResult(result: DuplexResult): string {
  if (result.basePairs.length === 0) {
    return [
      `Sequence A: ${result.sequenceA}`,
      `Sequence B: ${result.sequenceB}`,
      '',
      'No stable duplex found.'
    ].join('\n');
  }

  const lines: string[] = [
    `Sequence A: ${result.sequenceA}`,
    `Sequence B: ${result.sequenceB}`,
    '',
    `Hybridization Energy: ${result.energy.toFixed(2)} kcal/mol`,
    '',
    `Interaction Region:`,
    `  Sequence A: positions ${result.startA} - ${result.endA}`,
    `  Sequence B: positions ${result.startB} - ${result.endB}`,
    '',
    `Structure:`,
    `  A: 5'-${result.structureA}-3'`,
    `  B: 3'-${result.structureB.split('').reverse().join('')}-5'`,
    '',
    `Base Pairs (${result.basePairs.length}):`,
  ];

  for (const pair of result.basePairs) {
    const baseA = result.sequenceA[pair.posA - 1];
    const baseB = result.sequenceB[pair.posB - 1];
    lines.push(`  A:${pair.posA}(${baseA}) -- B:${pair.posB}(${baseB})`);
  }

  // ASCII art representation
  lines.push('');
  lines.push('Duplex Visualization:');

  if (result.basePairs.length > 0) {
    const subA = result.sequenceA.substring(result.startA - 1, result.endA);
    const subB = result.sequenceB.substring(result.startB - 1, result.endB).split('').reverse().join('');

    const pairSymbols = subA.split('').map((_, idx) => {
      const posA = result.startA + idx;
      const pair = result.basePairs.find(p => p.posA === posA);
      if (pair) return '|';
      return ' ';
    });

    lines.push(`  5'-${subA}-3'`);
    lines.push(`     ${pairSymbols.join('')}`);
    lines.push(`  3'-${subB}-5'`);
  }

  return lines.join('\n');
}
