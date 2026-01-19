/**
 * RNAsubopt TypeScript Implementation
 * Based on ViennaRNA Package
 *
 * Generates suboptimal RNA secondary structures within a specified
 * energy range from the minimum free energy (MFE) structure.
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
 * Suboptimal structure result
 */
export interface SuboptStructure {
  structure: string;
  energy: number;
  basePairs: Array<[number, number]>;
}

/**
 * Result of suboptimal folding
 */
export interface SuboptResult {
  sequence: string;
  mfeStructure: string;
  mfeEnergy: number;
  structures: SuboptStructure[];
  deltaEnergy: number;
  maxStructures: number;
}

/**
 * Options for suboptimal structure generation
 */
export interface SuboptOptions {
  deltaEnergy?: number;   // Energy range above MFE (default: 5 kcal/mol)
  maxStructures?: number; // Maximum number of structures (default: 100)
  sorted?: boolean;       // Sort by energy (default: true)
  unique?: boolean;       // Only unique structures (default: true)
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
 * Fold compound for subopt
 */
interface FoldCompound {
  sequence: string;
  encodedSeq: number[];
  length: number;
  pairType: (i: number, j: number) => PairTypeValue;
}

function createFoldCompound(sequence: string): FoldCompound {
  const cleanedSeq = cleanSequence(sequence);
  const encodedSeq = encodeSequence(cleanedSeq);

  return {
    sequence: cleanedSeq,
    encodedSeq,
    length: cleanedSeq.length,
    pairType: (i, j) => {
      const bi = safeGet(encodedSeq, i, 0);
      const bj = safeGet(encodedSeq, j, 0);
      return getPairType(bi, bj);
    }
  };
}

/**
 * Calculate hairpin loop energy
 */
function hairpinEnergy(fc: FoldCompound, i: number, j: number): number {
  const size = j - i - 1;
  const pairType = fc.pairType(i, j);

  if (size < MIN_HAIRPIN_SIZE) return INF;
  if (pairType === PairType.NONE) return INF;

  let energy = loopEnergy(size, hairpin37);

  if (size >= 3) {
    const si1 = safeGet(fc.encodedSeq, i + 1, 0);
    const sj1 = safeGet(fc.encodedSeq, j - 1, 0);
    energy += safeGet3D(mismatchH37, pairType, si1, sj1, 0);
  }

  energy += terminalPenalty(pairType);

  // Special loops
  const loopSeq = fc.sequence.substring(i - 1, j);
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

  return energy;
}

/**
 * Calculate interior loop energy
 */
function interiorEnergy(fc: FoldCompound, i: number, j: number, p: number, q: number): number {
  const pairType_ij = fc.pairType(i, j);
  const pairType_pq = fc.pairType(p, q);

  if (pairType_ij === PairType.NONE || pairType_pq === PairType.NONE) {
    return INF;
  }

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
 * Fill DP matrices for both MFE and subopt
 */
function fillMatrices(fc: FoldCompound): {
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
 * Convert pairs to dot-bracket
 */
function pairsToDotBracket(length: number, pairs: Array<[number, number]>): string {
  const structure = Array(length).fill('.');
  for (const [i, j] of pairs) {
    structure[i - 1] = '(';
    structure[j - 1] = ')';
  }
  return structure.join('');
}

/**
 * Calculate structure energy from base pairs
 */
function calculateEnergy(
  fc: FoldCompound,
  pairs: Array<[number, number]>,
  c: number[][]
): number {
  if (pairs.length === 0) return 0;

  const n = fc.length;
  const pairTable: number[] = Array(n + 1).fill(0);
  for (const [i, j] of pairs) {
    pairTable[i] = j;
    pairTable[j] = i;
  }

  // Find outermost pairs and sum their energies
  let energy = 0;
  const processed = new Set<string>();

  for (const [i, j] of pairs) {
    const key = `${i}-${j}`;
    if (processed.has(key)) continue;

    // Check if this is an outermost pair
    let isOutermost = true;
    for (const [pi, pj] of pairs) {
      if (pi < i && pj > j) {
        isOutermost = false;
        break;
      }
    }

    if (isOutermost) {
      const cij = safeGet2D(c, i, j, INF);
      if (cij < INF) {
        const pairType = fc.pairType(i, j);
        let contrib = cij + terminalPenalty(pairType);

        if (i > 1 && pairTable[i - 1] === 0) {
          const sk1 = safeGet(fc.encodedSeq, i - 1, 0);
          contrib += safeGet2D(dangle5_37, pairType, sk1, 0);
        }
        if (j < n && pairTable[j + 1] === 0) {
          const sj1 = safeGet(fc.encodedSeq, j + 1, 0);
          contrib += safeGet2D(dangle3_37, pairType, sj1, 0);
        }

        energy += contrib;
      }
    }
    processed.add(key);
  }

  return energy;
}

/**
 * Generate suboptimal structures using Wuchty algorithm
 */
function generateSubopt(
  fc: FoldCompound,
  c: number[][],
  _fML: number[][],  // Reserved for future multiloop enumeration
  f5: number[],
  deltaE: number,
  maxStructures: number
): SuboptStructure[] {
  const n = fc.length;
  const mfe = f5[n] ?? 0;
  const threshold = mfe + deltaE;
  const structures: SuboptStructure[] = [];
  const seen = new Set<string>();

  // Stack-based enumeration: [type, i, j, energy, pairs]
  // type: 0=f5, 1=c, 2=fML
  type StackItem = {
    type: number;
    i: number;
    j: number;
    energy: number;
    pairs: Array<[number, number]>;
  };

  const stack: StackItem[] = [{ type: 0, i: 1, j: n, energy: 0, pairs: [] }];

  while (stack.length > 0 && structures.length < maxStructures) {
    const item = stack.pop()!;
    const { type, i, j, energy, pairs } = item;

    if (type === 0) {
      // External loop (f5)
      if (j < 1) {
        // Complete structure
        const structure = pairsToDotBracket(n, pairs);
        if (!seen.has(structure)) {
          seen.add(structure);
          const actualEnergy = calculateEnergy(fc, pairs, c);
          if (actualEnergy <= threshold) {
            structures.push({
              structure,
              energy: actualEnergy / 100,
              basePairs: [...pairs]
            });
          }
        }
        continue;
      }

      // Option 1: j is unpaired
      if (energy + (f5[j - 1] ?? 0) - (f5[j] ?? 0) <= threshold - mfe) {
        stack.push({
          type: 0,
          i: 1,
          j: j - 1,
          energy: energy,
          pairs: [...pairs]
        });
      }

      // Option 2: (k, j) forms a pair
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

            const newEnergy = energy + contrib;
            const remaining = k > 1 ? (f5[k - 1] ?? 0) : 0;
            if (newEnergy + remaining <= threshold) {
              const newPairs = [...pairs, [k, j] as [number, number]];
              // Expand the (k,j) pair first, then continue f5
              stack.push({
                type: 1,
                i: k,
                j: j,
                energy: newEnergy,
                pairs: newPairs
              });
            }
          }
        }
      }
    } else if (type === 1) {
      // Closed pair (c matrix)
      const cij = safeGet2D(c, i, j, INF);
      if (cij >= INF) continue;

      // Check if it's a hairpin
      const hpEnergy = hairpinEnergy(fc, i, j);
      if (Math.abs(cij - hpEnergy) < 1) {
        // It's a hairpin, continue to external loop
        const remaining = i > 1 ? (f5[i - 1] ?? 0) : 0;
        if (energy + remaining - (i > 1 ? (f5[i - 1] ?? 0) : 0) <= threshold - mfe) {
          stack.push({
            type: 0,
            i: 1,
            j: i - 1,
            energy: energy - remaining,
            pairs
          });
        }
        continue;
      }

      // Check interior loops
      let found = false;
      for (let p = i + 1; p <= Math.min(i + 30, j - MIN_HAIRPIN_SIZE - 2) && !found; p++) {
        const maxQ = Math.min(j - 1, p + 30 - (p - i - 1));
        for (let q = Math.max(p + MIN_HAIRPIN_SIZE + 1, j - 30 + (p - i - 1)); q <= maxQ && !found; q++) {
          if (fc.pairType(p, q) !== PairType.NONE) {
            const cpq = safeGet2D(c, p, q, INF);
            if (cpq < INF) {
              const interior = interiorEnergy(fc, i, j, p, q) + cpq;
              if (Math.abs(cij - interior) < 1) {
                const newPairs = [...pairs, [p, q] as [number, number]];
                stack.push({
                  type: 1,
                  i: p,
                  j: q,
                  energy,
                  pairs: newPairs
                });
                found = true;
              }
            }
          }
        }
      }

      if (!found) {
        // It's a multiloop - simplified handling
        const remaining = i > 1 ? (f5[i - 1] ?? 0) : 0;
        stack.push({
          type: 0,
          i: 1,
          j: i - 1,
          energy: energy - remaining,
          pairs
        });
      }
    }
  }

  return structures;
}

/**
 * Main suboptimal folding function
 */
export function subopt(sequence: string, options: SuboptOptions = {}): SuboptResult {
  const {
    deltaEnergy = 5,
    maxStructures = 100,
    sorted = true,
    unique = true
  } = options;

  const fc = createFoldCompound(sequence);

  if (fc.length === 0) {
    throw new Error('Empty sequence provided');
  }

  if (fc.length < MIN_HAIRPIN_SIZE + 2) {
    return {
      sequence: fc.sequence,
      mfeStructure: '.'.repeat(fc.length),
      mfeEnergy: 0,
      structures: [{
        structure: '.'.repeat(fc.length),
        energy: 0,
        basePairs: []
      }],
      deltaEnergy,
      maxStructures
    };
  }

  // Fill DP matrices
  const { c, fML, f5 } = fillMatrices(fc);
  const mfe = (f5[fc.length] ?? 0) / 100;

  // Convert deltaEnergy from kcal/mol to centidecimal
  const deltaE = Math.round(deltaEnergy * 100);

  // Generate suboptimal structures
  let structures = generateSubopt(fc, c, fML, f5, deltaE, maxStructures * 2);

  // Ensure uniqueness
  if (unique) {
    const seenStructures = new Set<string>();
    structures = structures.filter(s => {
      if (seenStructures.has(s.structure)) return false;
      seenStructures.add(s.structure);
      return true;
    });
  }

  // Sort by energy
  if (sorted) {
    structures.sort((a, b) => a.energy - b.energy);
  }

  // Limit to maxStructures
  structures = structures.slice(0, maxStructures);

  // Get MFE structure
  const mfeStructure = structures.length > 0 && structures[0]!.energy === mfe
    ? structures[0]!.structure
    : '.'.repeat(fc.length);

  return {
    sequence: fc.sequence,
    mfeStructure,
    mfeEnergy: mfe,
    structures,
    deltaEnergy,
    maxStructures
  };
}

/**
 * Quick subopt returning just structures and energies
 */
export function suboptSimple(
  sequence: string,
  deltaEnergy: number = 5,
  maxStructures: number = 20
): Array<{ structure: string; energy: number }> {
  const result = subopt(sequence, { deltaEnergy, maxStructures });
  return result.structures.map(s => ({
    structure: s.structure,
    energy: s.energy
  }));
}

/**
 * Format subopt result as string
 */
export function formatResult(result: SuboptResult): string {
  const lines: string[] = [
    `Sequence: ${result.sequence}`,
    `MFE Structure: ${result.mfeStructure}`,
    `MFE Energy: ${result.mfeEnergy.toFixed(2)} kcal/mol`,
    ``,
    `Suboptimal Structures (within ${result.deltaEnergy} kcal/mol):`,
    `Found: ${result.structures.length} structures`,
    ``
  ];

  for (let i = 0; i < result.structures.length; i++) {
    const s = result.structures[i]!;
    lines.push(`${(i + 1).toString().padStart(3)}. ${s.structure}  (${s.energy.toFixed(2)} kcal/mol)`);
  }

  return lines.join('\n');
}
