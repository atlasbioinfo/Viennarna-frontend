/**
 * Extract and display energy matrices from RNA folding
 */

import { foldDebug, fold } from './src/lib/rnafold';

const testSequence = 'GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA';

// Get the fold result and matrices
const result = fold(testSequence);
const debug = foldDebug(testSequence);

const { f5, c, fML, encodedSeq, length } = debug;
const n = length;
const INF = 1e9;

console.log('=== RNA Folding Energy Matrices ===\n');
console.log('Sequence:', testSequence);
console.log('Length:', n);
console.log('Structure:', result.structure);
console.log('MFE:', result.mfe, 'kcal/mol');
console.log('');

// F5 array - external loop energy from position 1 to j
console.log('=== F5 Array (External Loop Energy) ===');
console.log('f5[j] = minimum energy of structure from position 1 to j\n');
console.log('Position\tEnergy (0.01 kcal/mol)\tEnergy (kcal/mol)');
console.log('-'.repeat(60));
for (let j = 1; j <= n; j++) {
  const e = f5[j] ?? 0;
  console.log(`${j}\t\t${e}\t\t\t${(e / 100).toFixed(2)}`);
}
console.log('');

// C matrix - energy of structure with closing pair (i,j)
console.log('=== C Matrix (Paired Region Energy) ===');
console.log('c[i,j] = minimum energy of structure with closing pair (i,j)\n');

// Show non-INF values
console.log('Non-infinite c[i,j] values:');
console.log('i\tj\tEnergy\t\tkcal/mol\tPair');
console.log('-'.repeat(70));

const baseNames = ['?', 'A', 'C', 'G', 'U'];
const pairs: Array<{i: number, j: number, e: number}> = [];

for (let i = 1; i <= n; i++) {
  for (let j = i + 4; j <= n; j++) {
    const e = c[i]?.[j];
    if (e !== undefined && e < INF / 2) {
      pairs.push({ i, j, e });
    }
  }
}

// Sort by energy (most stable first)
pairs.sort((a, b) => a.e - b.e);

// Show top 30 most stable pairs
console.log('\nTop 30 most stable paired regions:');
for (let k = 0; k < Math.min(30, pairs.length); k++) {
  const { i, j, e } = pairs[k];
  const bi = encodedSeq[i];
  const bj = encodedSeq[j];
  console.log(`${i}\t${j}\t${e}\t\t${(e / 100).toFixed(2)}\t\t${baseNames[bi]}-${baseNames[bj]}`);
}

console.log('');

// fML matrix - multibranch loop component energy
console.log('=== fML Matrix (Multibranch Loop Component Energy) ===');
console.log('fML[i,j] = minimum energy of multibranch loop component from i to j\n');

const fmlPairs: Array<{i: number, j: number, e: number}> = [];
for (let i = 1; i <= n; i++) {
  for (let j = i + 4; j <= n; j++) {
    const e = fML[i]?.[j];
    if (e !== undefined && e < INF / 2) {
      fmlPairs.push({ i, j, e });
    }
  }
}

fmlPairs.sort((a, b) => a.e - b.e);

console.log('Top 20 most stable fML regions:');
console.log('i\tj\tEnergy\t\tkcal/mol');
console.log('-'.repeat(50));
for (let k = 0; k < Math.min(20, fmlPairs.length); k++) {
  const { i, j, e } = fmlPairs[k];
  console.log(`${i}\t${j}\t${e}\t\t${(e / 100).toFixed(2)}`);
}

console.log('');

// Export as JSON for further analysis
const exportData = {
  sequence: testSequence,
  length: n,
  structure: result.structure,
  mfe: result.mfe,
  f5: f5.slice(0, n + 1),
  // Export sparse c matrix (only non-INF values)
  c_matrix: pairs.map(p => ({ i: p.i, j: p.j, energy: p.e, kcal: p.e / 100 })),
  // Export sparse fML matrix
  fML_matrix: fmlPairs.map(p => ({ i: p.i, j: p.j, energy: p.e, kcal: p.e / 100 }))
};

console.log('=== JSON Export ===');
console.log('(Can be used for further analysis)\n');
console.log(JSON.stringify(exportData, null, 2).substring(0, 2000) + '...');
