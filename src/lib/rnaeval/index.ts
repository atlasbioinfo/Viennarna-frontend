/**
 * RNAeval TypeScript Implementation
 * Based on ViennaRNA Package
 *
 * Evaluates the free energy of an RNA secondary structure
 * with detailed energy decomposition by loop type
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
 * Individual loop energy contribution
 */
export interface LoopEnergy {
  type: 'hairpin' | 'stack' | 'bulge' | 'internal' | 'multiloop' | 'external';
  i: number;          // Start position (1-indexed)
  j: number;          // End position (1-indexed)
  energy: number;     // Energy in kcal/mol
  size?: number;      // Loop size for hairpin/bulge/internal
  innerPairs?: Array<[number, number]>;  // For multiloop
  details?: string;   // Human-readable description
}

/**
 * Result of RNA structure evaluation
 */
export interface EvalResult {
  sequence: string;
  structure: string;
  totalEnergy: number;
  basePairs: Array<[number, number]>;
  loopEnergies: LoopEnergy[];
  energyByType: {
    hairpin: number;
    stack: number;
    bulge: number;
    internal: number;
    multiloop: number;
    external: number;
  };
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

/**
 * Get terminal AU/GU penalty
 */
function terminalPenalty(pairType: PairTypeValue): number {
  return isAUorGU(pairType) ? TerminalAU : 0;
}

/**
 * Calculate hairpin loop energy with details
 */
function hairpinEnergyDetailed(
  sequence: string,
  encodedSeq: number[],
  i: number,
  j: number
): { energy: number; details: string } {
  const size = j - i - 1;
  const bi = safeGet(encodedSeq, i, 0);
  const bj = safeGet(encodedSeq, j, 0);
  const pairType = getPairType(bi, bj);

  if (size < MIN_HAIRPIN_SIZE) return { energy: INF, details: 'Too short' };
  if (pairType === PairType.NONE) return { energy: INF, details: 'Invalid pair' };

  let energy = loopEnergy(size, hairpin37);
  const details: string[] = [`Loop size: ${size}, base energy: ${(energy / 100).toFixed(2)}`];

  // Add mismatch energy for size >= 3
  if (size >= 3) {
    const si1 = safeGet(encodedSeq, i + 1, 0);
    const sj1 = safeGet(encodedSeq, j - 1, 0);
    const mismatch = safeGet3D(mismatchH37, pairType, si1, sj1, 0);
    if (mismatch !== 0) {
      energy += mismatch;
      details.push(`Mismatch: ${(mismatch / 100).toFixed(2)}`);
    }
  }

  // Terminal AU/GU penalty
  const termPenalty = terminalPenalty(pairType);
  if (termPenalty > 0) {
    energy += termPenalty;
    details.push(`AU/GU penalty: ${(termPenalty / 100).toFixed(2)}`);
  }

  // Check for special loops
  const loopSeq = sequence.substring(i - 1, j);
  if (size === 4) {
    for (const tl of Tetraloops) {
      if (loopSeq === tl.seq) {
        energy += tl.energy;
        details.push(`Tetraloop bonus (${tl.seq}): ${(tl.energy / 100).toFixed(2)}`);
        break;
      }
    }
  } else if (size === 3) {
    for (const tl of Triloops) {
      if (loopSeq === tl.seq) {
        energy += tl.energy;
        details.push(`Triloop bonus (${tl.seq}): ${(tl.energy / 100).toFixed(2)}`);
        break;
      }
    }
  } else if (size === 6) {
    for (const hl of Hexaloops) {
      if (loopSeq === hl.seq) {
        energy += hl.energy;
        details.push(`Hexaloop bonus (${hl.seq}): ${(hl.energy / 100).toFixed(2)}`);
        break;
      }
    }
  }

  return { energy, details: details.join('; ') };
}

/**
 * Calculate interior loop energy with details
 */
function interiorEnergyDetailed(
  encodedSeq: number[],
  i: number,
  j: number,
  p: number,
  q: number
): { energy: number; loopType: 'stack' | 'bulge' | 'internal'; details: string } {
  const bi = safeGet(encodedSeq, i, 0);
  const bj = safeGet(encodedSeq, j, 0);
  const bp = safeGet(encodedSeq, p, 0);
  const bq = safeGet(encodedSeq, q, 0);

  const pairType_ij = getPairType(bi, bj);
  const pairType_pq = getPairType(bp, bq);

  if (pairType_ij === PairType.NONE || pairType_pq === PairType.NONE) {
    return { energy: INF, loopType: 'internal', details: 'Invalid pair' };
  }

  const n1 = p - i - 1; // 5' side unpaired
  const n2 = j - q - 1; // 3' side unpaired

  if (n1 === 0 && n2 === 0) {
    // Stacking
    const energy = safeGet2D(stack37, pairType_ij, pairType_pq, INF);
    return {
      energy,
      loopType: 'stack',
      details: `Stacking energy: ${(energy / 100).toFixed(2)}`
    };
  }

  if (n1 === 0 || n2 === 0) {
    // Bulge loop
    const size = n1 + n2;
    let energy = loopEnergy(size, bulge37);
    const details: string[] = [`Bulge size: ${size}, base energy: ${(energy / 100).toFixed(2)}`];

    if (size === 1) {
      const stackE = safeGet2D(stack37, pairType_ij, pairType_pq, 0);
      energy += stackE;
      details.push(`Stack bonus: ${(stackE / 100).toFixed(2)}`);
    } else {
      const tp1 = terminalPenalty(pairType_ij);
      const tp2 = terminalPenalty(pairType_pq);
      energy += tp1 + tp2;
      if (tp1 > 0 || tp2 > 0) {
        details.push(`AU/GU penalties: ${((tp1 + tp2) / 100).toFixed(2)}`);
      }
    }

    return { energy, loopType: 'bulge', details: details.join('; ') };
  }

  // Internal loop
  const size = n1 + n2;
  let energy: number;
  const details: string[] = [`Internal loop ${n1}x${n2}`];

  const si1 = safeGet(encodedSeq, i + 1, 0);
  const sj1 = safeGet(encodedSeq, j - 1, 0);
  const sq1 = safeGet(encodedSeq, q + 1, 0);
  const sp1 = safeGet(encodedSeq, p - 1, 0);

  energy = loopEnergy(size, internalLoop37);
  details.push(`Base energy: ${(energy / 100).toFixed(2)}`);

  // Ninio asymmetry penalty for non-symmetric loops
  if (n1 !== n2 && !(n1 === 1 && n2 === 1)) {
    const asymmetry = Math.abs(n1 - n2);
    const ninioE = Math.min(MAX_NINIO, asymmetry * ninio37);
    energy += ninioE;
    details.push(`Ninio asymmetry: ${(ninioE / 100).toFixed(2)}`);
  }

  // Mismatch energies
  const mm1 = safeGet3D(mismatchI37, pairType_ij, si1, sj1, 0);
  const mm2 = safeGet3D(mismatchI37, pairType_pq, sq1, sp1, 0);
  if (mm1 !== 0 || mm2 !== 0) {
    energy += mm1 + mm2;
    details.push(`Mismatches: ${((mm1 + mm2) / 100).toFixed(2)}`);
  }

  return { energy, loopType: 'internal', details: details.join('; ') };
}

/**
 * Parse dot-bracket structure to base pairs
 */
function parseStructure(structure: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const parenStack: number[] = [];
  const bracketStack: number[] = [];
  const braceStack: number[] = [];

  for (let i = 0; i < structure.length; i++) {
    const c = structure[i];
    if (c === '(') {
      parenStack.push(i + 1); // 1-indexed
    } else if (c === ')') {
      if (parenStack.length === 0) {
        throw new Error(`Unbalanced structure at position ${i + 1}: too many ')' brackets`);
      }
      const openIdx = parenStack.pop()!;
      pairs.push([openIdx, i + 1]);
    } else if (c === '[') {
      bracketStack.push(i + 1);
    } else if (c === ']') {
      if (bracketStack.length === 0) {
        throw new Error(`Unbalanced structure at position ${i + 1}: too many ']' brackets`);
      }
      const openIdx = bracketStack.pop()!;
      pairs.push([openIdx, i + 1]);
    } else if (c === '{') {
      braceStack.push(i + 1);
    } else if (c === '}') {
      if (braceStack.length === 0) {
        throw new Error(`Unbalanced structure at position ${i + 1}: too many '}' brackets`);
      }
      const openIdx = braceStack.pop()!;
      pairs.push([openIdx, i + 1]);
    }
  }

  if (parenStack.length > 0) {
    throw new Error('Unbalanced structure: too many opening parentheses');
  }
  if (bracketStack.length > 0) {
    throw new Error('Unbalanced structure: too many opening brackets');
  }
  if (braceStack.length > 0) {
    throw new Error('Unbalanced structure: too many opening braces');
  }

  return pairs;
}

/**
 * Evaluate the free energy of an RNA structure with detailed decomposition
 */
export function evaluate(sequence: string, structure: string): EvalResult {
  const cleanedSequence = cleanSequence(sequence);

  if (cleanedSequence.length !== structure.length) {
    throw new Error(`Sequence length (${cleanedSequence.length}) and structure length (${structure.length}) must match`);
  }

  const pairs = parseStructure(structure);
  const encodedSeq = encodeSequence(cleanedSequence);
  const n = cleanedSequence.length;

  // Build pair table
  const pairTable: number[] = Array(n + 1).fill(0);
  for (const [i, j] of pairs) {
    pairTable[i] = j;
    pairTable[j] = i;
  }

  // Validate base pairs
  for (const [i, j] of pairs) {
    const bi = safeGet(encodedSeq, i, 0);
    const bj = safeGet(encodedSeq, j, 0);
    const pairType = getPairType(bi, bj);
    if (pairType === PairType.NONE) {
      throw new Error(`Invalid base pair at positions ${i} (${cleanedSequence[i - 1]}) and ${j} (${cleanedSequence[j - 1]})`);
    }
  }

  const loopEnergies: LoopEnergy[] = [];
  const energyByType = {
    hairpin: 0,
    stack: 0,
    bulge: 0,
    internal: 0,
    multiloop: 0,
    external: 0
  };

  // Sort pairs by opening position
  const sortedPairs = [...pairs].sort((a, b) => a[0] - b[0]);

  // Process each base pair
  for (const [i, j] of sortedPairs) {
    // Find inner pairs
    let k = i + 1;
    const innerPairs: Array<[number, number]> = [];

    while (k < j) {
      const pk = pairTable[k] ?? 0;
      if (pk > k && pk < j) {
        innerPairs.push([k, pk]);
        k = pk + 1;
      } else {
        k++;
      }
    }

    const pairType = getPairType(
      safeGet(encodedSeq, i, 0),
      safeGet(encodedSeq, j, 0)
    );

    if (innerPairs.length === 0) {
      // Hairpin loop
      const { energy, details } = hairpinEnergyDetailed(cleanedSequence, encodedSeq, i, j);
      loopEnergies.push({
        type: 'hairpin',
        i,
        j,
        energy: energy / 100,
        size: j - i - 1,
        details
      });
      energyByType.hairpin += energy;
    } else if (innerPairs.length === 1) {
      // Interior loop (stack/bulge/internal)
      const [p, q] = innerPairs[0]!;
      const { energy, loopType, details } = interiorEnergyDetailed(encodedSeq, i, j, p, q);
      loopEnergies.push({
        type: loopType,
        i,
        j,
        energy: energy / 100,
        size: (p - i - 1) + (j - q - 1),
        details
      });
      energyByType[loopType] += energy;
    } else {
      // Multi-loop
      let energy = ML_closing;
      const details: string[] = [`Closing penalty: ${(ML_closing / 100).toFixed(2)}`];

      // Add mismatch at closing pair
      const si1 = safeGet(encodedSeq, i + 1, 0);
      const sj1 = safeGet(encodedSeq, j - 1, 0);
      const mmEnergy = safeGet3D(mismatchM37, pairType, si1, sj1, 0);
      energy += mmEnergy + terminalPenalty(pairType);

      if (mmEnergy !== 0) {
        details.push(`Closing mismatch: ${(mmEnergy / 100).toFixed(2)}`);
      }

      // Add branch contributions
      for (const [p, q] of innerPairs) {
        const innerPairType = getPairType(
          safeGet(encodedSeq, p, 0),
          safeGet(encodedSeq, q, 0)
        );
        energy += ML_intern + terminalPenalty(innerPairType);
      }
      details.push(`Branches (${innerPairs.length}): ${((innerPairs.length * ML_intern) / 100).toFixed(2)}`);

      // Unpaired bases
      let unpaired = j - i - 1;
      for (const [p, q] of innerPairs) {
        unpaired -= (q - p + 1);
      }
      energy += unpaired * ML_BASE;
      if (ML_BASE !== 0 && unpaired > 0) {
        details.push(`Unpaired (${unpaired}): ${((unpaired * ML_BASE) / 100).toFixed(2)}`);
      }

      loopEnergies.push({
        type: 'multiloop',
        i,
        j,
        energy: energy / 100,
        innerPairs,
        details: details.join('; ')
      });
      energyByType.multiloop += energy;
    }
  }

  // External loop contributions (dangling ends)
  let externalEnergy = 0;
  const externalDetails: string[] = [];

  for (const [i, j] of sortedPairs) {
    const pairType = getPairType(
      safeGet(encodedSeq, i, 0),
      safeGet(encodedSeq, j, 0)
    );

    // Only for outermost pairs (not enclosed by another pair)
    const isOutermost = !sortedPairs.some(([pi, pj]) => pi < i && pj > j);
    if (!isOutermost) continue;

    // 5' dangling end
    if (i > 1 && pairTable[i - 1] === 0) {
      const sk1 = safeGet(encodedSeq, i - 1, 0);
      const d5 = safeGet2D(dangle5_37, pairType, sk1, 0);
      externalEnergy += d5;
      if (d5 !== 0) {
        externalDetails.push(`5' dangle at ${i}: ${(d5 / 100).toFixed(2)}`);
      }
    }

    // 3' dangling end
    if (j < n && pairTable[j + 1] === 0) {
      const sj1 = safeGet(encodedSeq, j + 1, 0);
      const d3 = safeGet2D(dangle3_37, pairType, sj1, 0);
      externalEnergy += d3;
      if (d3 !== 0) {
        externalDetails.push(`3' dangle at ${j}: ${(d3 / 100).toFixed(2)}`);
      }
    }

    // Terminal AU/GU penalty for external pairs
    const tp = terminalPenalty(pairType);
    externalEnergy += tp;
    if (tp > 0) {
      externalDetails.push(`AU/GU penalty at ${i}-${j}: ${(tp / 100).toFixed(2)}`);
    }
  }

  if (externalEnergy !== 0 || externalDetails.length > 0) {
    loopEnergies.push({
      type: 'external',
      i: 1,
      j: n,
      energy: externalEnergy / 100,
      details: externalDetails.length > 0 ? externalDetails.join('; ') : 'No contributions'
    });
    energyByType.external = externalEnergy;
  }

  // Calculate total energy
  const totalEnergy = Object.values(energyByType).reduce((a, b) => a + b, 0) / 100;

  // Convert energyByType to kcal/mol
  const energyByTypeKcal = {
    hairpin: energyByType.hairpin / 100,
    stack: energyByType.stack / 100,
    bulge: energyByType.bulge / 100,
    internal: energyByType.internal / 100,
    multiloop: energyByType.multiloop / 100,
    external: energyByType.external / 100
  };

  return {
    sequence: cleanedSequence,
    structure,
    totalEnergy,
    basePairs: sortedPairs,
    loopEnergies,
    energyByType: energyByTypeKcal
  };
}

/**
 * Simple evaluation returning just the energy
 */
export function evalEnergy(sequence: string, structure: string): number {
  return evaluate(sequence, structure).totalEnergy;
}

/**
 * Format evaluation result as string
 */
export function formatResult(result: EvalResult): string {
  const lines: string[] = [
    `Sequence: ${result.sequence}`,
    `Structure: ${result.structure}`,
    ``,
    `Total Free Energy: ${result.totalEnergy.toFixed(2)} kcal/mol`,
    ``,
    `Energy Breakdown by Type:`,
  ];

  if (result.energyByType.stack !== 0) {
    lines.push(`  Stacking:    ${result.energyByType.stack.toFixed(2)} kcal/mol`);
  }
  if (result.energyByType.hairpin !== 0) {
    lines.push(`  Hairpin:     ${result.energyByType.hairpin.toFixed(2)} kcal/mol`);
  }
  if (result.energyByType.bulge !== 0) {
    lines.push(`  Bulge:       ${result.energyByType.bulge.toFixed(2)} kcal/mol`);
  }
  if (result.energyByType.internal !== 0) {
    lines.push(`  Internal:    ${result.energyByType.internal.toFixed(2)} kcal/mol`);
  }
  if (result.energyByType.multiloop !== 0) {
    lines.push(`  Multi-loop:  ${result.energyByType.multiloop.toFixed(2)} kcal/mol`);
  }
  if (result.energyByType.external !== 0) {
    lines.push(`  External:    ${result.energyByType.external.toFixed(2)} kcal/mol`);
  }

  lines.push('');
  lines.push('Detailed Loop Contributions:');

  for (const loop of result.loopEnergies) {
    lines.push(`  ${loop.type.charAt(0).toUpperCase() + loop.type.slice(1)} [${loop.i}-${loop.j}]: ${loop.energy.toFixed(2)} kcal/mol`);
    if (loop.details) {
      lines.push(`    ${loop.details}`);
    }
  }

  return lines.join('\n');
}
