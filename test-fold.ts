import { fold } from './src/lib/rnafold';

const testSequence = 'GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA';
const expectedStructure = '(((((((..((((........)))).(((((.......))))).....(((((.......))))))))))))....';
const expectedMFE = -22.40;

console.log('Testing RNA fold with tRNA sequence...');
console.log('Input sequence:', testSequence);
console.log('Expected structure:', expectedStructure);
console.log('Expected MFE:', expectedMFE);
console.log('');

try {
  const result = fold(testSequence);
  console.log('Result structure:', result.structure);
  console.log('Result MFE:', result.mfe.toFixed(2));
  console.log('');
  console.log('Structure matches:', result.structure === expectedStructure ? 'YES' : 'NO');
  console.log('MFE diff:', Math.abs(result.mfe - expectedMFE).toFixed(2));
} catch (error) {
  console.error('Error:', error);
}
