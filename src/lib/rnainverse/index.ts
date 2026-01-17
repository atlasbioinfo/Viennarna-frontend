/**
 * RNAinverse TypeScript Implementation
 * Based on ViennaRNA Package
 *
 * Designs RNA sequences that fold into a target secondary structure.
 * Uses a combination of constraint-based initialization and adaptive
 * walk optimization.
 */

import { fold } from '../rnafold';
import { cleanSequence } from '../rnafold/sequence';

/**
 * Result of RNA inverse folding (design)
 */
export interface InverseResult {
  targetStructure: string;
  designedSequence: string;
  actualStructure: string;
  targetEnergy: number;
  distance: number;        // Hamming distance between target and actual structure
  success: boolean;        // Whether design matches target exactly
  iterations: number;      // Number of optimization iterations
  attempts: number;        // Number of design attempts
}

/**
 * Options for inverse folding
 */
export interface InverseOptions {
  maxIterations?: number;   // Max optimization iterations per attempt (default: 1000)
  maxAttempts?: number;     // Max design attempts (default: 10)
  startSequence?: string;   // Optional starting sequence
  fixedPositions?: string;  // Positions to keep fixed (e.g., "NNN..NNN" where N means random, . means fixed)
}

/**
 * Nucleotide bases
 */
const BASES = ['A', 'C', 'G', 'U'] as const;

/**
 * Complementary bases for Watson-Crick pairs
 */
const COMPLEMENTS: Record<string, string[]> = {
  'A': ['U'],
  'U': ['A', 'G'],  // U can pair with A (Watson-Crick) or G (wobble)
  'G': ['C', 'U'],  // G can pair with C (Watson-Crick) or U (wobble)
  'C': ['G'],
};

/**
 * Get random base
 */
function randomBase(): string {
  return BASES[Math.floor(Math.random() * BASES.length)]!;
}

/**
 * Get random complement for a base
 */
function randomComplement(base: string): string {
  const comps = COMPLEMENTS[base];
  if (!comps || comps.length === 0) {
    return randomBase();
  }
  return comps[Math.floor(Math.random() * comps.length)]!;
}

/**
 * Parse target structure to get base pairs
 */
function parseStructure(structure: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const stack: number[] = [];

  for (let i = 0; i < structure.length; i++) {
    if (structure[i] === '(') {
      stack.push(i);
    } else if (structure[i] === ')') {
      if (stack.length > 0) {
        const j = stack.pop()!;
        pairs.push([j, i]);
      }
    }
  }

  return pairs;
}

/**
 * Calculate Hamming distance between two structures
 */
function structureDistance(struct1: string, struct2: string): number {
  let distance = 0;
  const len = Math.min(struct1.length, struct2.length);

  for (let i = 0; i < len; i++) {
    if (struct1[i] !== struct2[i]) {
      distance++;
    }
  }

  // Add difference in length
  distance += Math.abs(struct1.length - struct2.length);

  return distance;
}

/**
 * Check if two bases can form a valid pair
 */
function canPair(base1: string, base2: string): boolean {
  const pairs = [
    ['A', 'U'], ['U', 'A'],
    ['G', 'C'], ['C', 'G'],
    ['G', 'U'], ['U', 'G']
  ];
  return pairs.some(([a, b]) => base1 === a && base2 === b);
}

/**
 * Initialize sequence based on target structure
 */
function initializeSequence(structure: string, startSequence?: string): string {
  const pairs = parseStructure(structure);
  const n = structure.length;

  let sequence: string[];

  if (startSequence && startSequence.length === n) {
    sequence = cleanSequence(startSequence).split('');
  } else {
    // Initialize with random bases
    sequence = Array(n).fill('').map(() => randomBase());
  }

  // Set complementary bases for pairs
  for (const [i, j] of pairs) {
    // Randomly choose which base to set first
    if (Math.random() < 0.5) {
      sequence[j] = randomComplement(sequence[i]!);
    } else {
      sequence[i] = randomComplement(sequence[j]!);
    }
  }

  // Verify and fix any non-pairing bases
  for (const [i, j] of pairs) {
    if (!canPair(sequence[i]!, sequence[j]!)) {
      // Reset to a valid pair
      const pairChoice = Math.random();
      if (pairChoice < 0.3) {
        sequence[i] = 'G';
        sequence[j] = 'C';
      } else if (pairChoice < 0.6) {
        sequence[i] = 'C';
        sequence[j] = 'G';
      } else if (pairChoice < 0.8) {
        sequence[i] = 'A';
        sequence[j] = 'U';
      } else {
        sequence[i] = 'U';
        sequence[j] = 'A';
      }
    }
  }

  return sequence.join('');
}

/**
 * Mutate a single position in the sequence
 */
function mutatePosition(
  sequence: string,
  position: number,
  pairs: Array<[number, number]>,
  fixedMask?: boolean[]
): string {
  if (fixedMask && fixedMask[position]) {
    return sequence;
  }

  const chars = sequence.split('');
  const oldBase = chars[position]!;

  // Find if this position is paired
  let pairedPosition = -1;
  for (const [i, j] of pairs) {
    if (i === position) {
      pairedPosition = j;
      break;
    } else if (j === position) {
      pairedPosition = i;
      break;
    }
  }

  if (pairedPosition >= 0 && !(fixedMask && fixedMask[pairedPosition])) {
    // Mutate both positions to maintain pairing
    const pairChoice = Math.random();
    if (pairChoice < 0.25) {
      chars[position] = 'G';
      chars[pairedPosition] = 'C';
    } else if (pairChoice < 0.5) {
      chars[position] = 'C';
      chars[pairedPosition] = 'G';
    } else if (pairChoice < 0.7) {
      chars[position] = 'A';
      chars[pairedPosition] = 'U';
    } else if (pairChoice < 0.9) {
      chars[position] = 'U';
      chars[pairedPosition] = 'A';
    } else {
      // Wobble pair
      if (Math.random() < 0.5) {
        chars[position] = 'G';
        chars[pairedPosition] = 'U';
      } else {
        chars[position] = 'U';
        chars[pairedPosition] = 'G';
      }
    }
  } else {
    // Unpaired position, mutate to random different base
    let newBase = oldBase;
    while (newBase === oldBase) {
      newBase = randomBase();
    }
    chars[position] = newBase;
  }

  return chars.join('');
}

/**
 * Adaptive walk optimization
 */
function adaptiveWalk(
  sequence: string,
  targetStructure: string,
  pairs: Array<[number, number]>,
  maxIterations: number,
  fixedMask?: boolean[]
): { sequence: string; structure: string; distance: number; iterations: number } {
  let currentSequence = sequence;
  let foldResult = fold(currentSequence);
  let currentDistance = structureDistance(targetStructure, foldResult.structure);

  let iterations = 0;
  const n = targetStructure.length;

  while (currentDistance > 0 && iterations < maxIterations) {
    iterations++;

    // Find positions where structure differs
    const diffPositions: number[] = [];
    for (let i = 0; i < n; i++) {
      if (targetStructure[i] !== foldResult.structure[i]) {
        if (!fixedMask || !fixedMask[i]) {
          diffPositions.push(i);
        }
      }
    }

    if (diffPositions.length === 0) {
      // Try random positions
      const randomPos = Math.floor(Math.random() * n);
      if (!fixedMask || !fixedMask[randomPos]) {
        diffPositions.push(randomPos);
      }
    }

    // Try mutating a random differing position
    const posToMutate = diffPositions[Math.floor(Math.random() * diffPositions.length)]!;
    const newSequence = mutatePosition(currentSequence, posToMutate, pairs, fixedMask);

    const newFoldResult = fold(newSequence);
    const newDistance = structureDistance(targetStructure, newFoldResult.structure);

    // Accept if better or equal (for exploration)
    if (newDistance <= currentDistance) {
      currentSequence = newSequence;
      foldResult = newFoldResult;
      currentDistance = newDistance;
    } else if (Math.random() < 0.1) {
      // Small chance to accept worse solution (simulated annealing-like)
      currentSequence = newSequence;
      foldResult = newFoldResult;
      currentDistance = newDistance;
    }

    if (currentDistance === 0) break;
  }

  return {
    sequence: currentSequence,
    structure: foldResult.structure,
    distance: currentDistance,
    iterations
  };
}

/**
 * Main inverse folding function
 */
export function inverse(targetStructure: string, options: InverseOptions = {}): InverseResult {
  const {
    maxIterations = 1000,
    maxAttempts = 10,
    startSequence,
    fixedPositions
  } = options;

  // Validate structure
  const cleanedStructure = targetStructure.replace(/[^().]/g, '.');
  if (cleanedStructure.length === 0) {
    throw new Error('Empty target structure');
  }

  // Parse fixed positions mask
  let fixedMask: boolean[] | undefined;
  if (fixedPositions) {
    fixedMask = fixedPositions.split('').map(c => c === '.');
  }

  const pairs = parseStructure(cleanedStructure);

  let bestResult = {
    sequence: '',
    structure: '',
    distance: Infinity,
    iterations: 0
  };
  let totalIterations = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Initialize sequence
    const initialSequence = initializeSequence(cleanedStructure, startSequence);

    // Run adaptive walk
    const result = adaptiveWalk(
      initialSequence,
      cleanedStructure,
      pairs,
      maxIterations,
      fixedMask
    );

    totalIterations += result.iterations;

    if (result.distance < bestResult.distance) {
      bestResult = result;
    }

    if (result.distance === 0) {
      break;
    }
  }

  // Get final energy
  const finalFold = fold(bestResult.sequence);

  return {
    targetStructure: cleanedStructure,
    designedSequence: bestResult.sequence,
    actualStructure: bestResult.structure,
    targetEnergy: finalFold.mfe,
    distance: bestResult.distance,
    success: bestResult.distance === 0,
    iterations: totalIterations,
    attempts: Math.min(maxAttempts, Math.ceil(totalIterations / maxIterations) + 1)
  };
}

/**
 * Design multiple sequences for the same target
 */
export function inverseMultiple(
  targetStructure: string,
  count: number = 5,
  options: InverseOptions = {}
): InverseResult[] {
  const results: InverseResult[] = [];
  const seenSequences = new Set<string>();

  const attemptsPerDesign = Math.max(3, Math.floor((options.maxAttempts ?? 10) / 2));

  for (let i = 0; i < count * 3 && results.length < count; i++) {
    const result = inverse(targetStructure, {
      ...options,
      maxAttempts: attemptsPerDesign
    });

    if (result.success && !seenSequences.has(result.designedSequence)) {
      seenSequences.add(result.designedSequence);
      results.push(result);
    }
  }

  // Sort by energy
  results.sort((a, b) => a.targetEnergy - b.targetEnergy);

  return results;
}

/**
 * Format inverse result as string
 */
export function formatResult(result: InverseResult): string {
  const statusIcon = result.success ? '✓' : '✗';
  const status = result.success ? 'SUCCESS' : 'PARTIAL';

  const lines: string[] = [
    `Target:   ${result.targetStructure}`,
    `Designed: ${result.designedSequence}`,
    `Actual:   ${result.actualStructure}`,
    '',
    `Status: ${statusIcon} ${status}`,
    `Energy: ${result.targetEnergy.toFixed(2)} kcal/mol`,
    `Distance: ${result.distance} (${result.distance === 0 ? 'exact match' : 'positions differ'})`,
    `Iterations: ${result.iterations}`,
    `Attempts: ${result.attempts}`,
  ];

  if (!result.success) {
    lines.push('');
    lines.push('Mismatches:');
    for (let i = 0; i < result.targetStructure.length; i++) {
      if (result.targetStructure[i] !== result.actualStructure[i]) {
        lines.push(`  Position ${i + 1}: target '${result.targetStructure[i]}' vs actual '${result.actualStructure[i]}'`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Validate if a structure string is well-formed
 */
export function validateStructure(structure: string): { valid: boolean; error?: string } {
  let depth = 0;

  for (let i = 0; i < structure.length; i++) {
    const c = structure[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth < 0) {
        return { valid: false, error: `Unmatched ')' at position ${i + 1}` };
      }
    } else if (c !== '.') {
      return { valid: false, error: `Invalid character '${c}' at position ${i + 1}` };
    }
  }

  if (depth !== 0) {
    return { valid: false, error: `${depth} unmatched '(' brackets` };
  }

  return { valid: true };
}
