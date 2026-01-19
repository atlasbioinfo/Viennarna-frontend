<script setup lang="ts">
import { ref, computed } from 'vue';
import { cofold, type CofoldResult } from '../lib/rnacofold';
import { cleanSequence, isValidSequence } from '../lib/rnafold';

// Input
const sequenceA = ref('');
const sequenceB = ref('');
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<CofoldResult | null>(null);

// Examples
const examples = [
  {
    name: 'Complementary',
    seqA: 'GCGCGCGCGC',
    seqB: 'GCGCGCGCGC'
  },
  {
    name: 'miRNA-target',
    seqA: 'UAGCAGCACGUAAAUAUUGGCG',
    seqB: 'CGCCAAUAUUUACGUGCUGCUA'
  },
  {
    name: 'Stem-loop pair',
    seqA: 'GGGAAACCC',
    seqB: 'GGGAAACCC'
  }
];

// Validation
const validationA = computed(() => {
  const seq = sequenceA.value.trim();
  if (!seq) return { valid: false, message: '' };
  if (!isValidSequence(seq)) return { valid: false, message: 'Invalid nucleotides' };
  return { valid: true, message: `${cleanSequence(seq).length} nt` };
});

const validationB = computed(() => {
  const seq = sequenceB.value.trim();
  if (!seq) return { valid: false, message: '' };
  if (!isValidSequence(seq)) return { valid: false, message: 'Invalid nucleotides' };
  return { valid: true, message: `${cleanSequence(seq).length} nt` };
});

const canFold = computed(() => {
  return validationA.value.valid && validationB.value.valid;
});

// Run cofold
async function runCofold() {
  if (!canFold.value) return;

  error.value = null;
  result.value = null;
  isProcessing.value = true;

  try {
    await new Promise(resolve => setTimeout(resolve, 10));
    result.value = cofold(sequenceA.value, sequenceB.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Cofolding failed';
  } finally {
    isProcessing.value = false;
  }
}

// Load example
function loadExample(example: typeof examples[0]) {
  sequenceA.value = example.seqA;
  sequenceB.value = example.seqB;
  result.value = null;
  error.value = null;
}

// Clear
function clearAll() {
  sequenceA.value = '';
  sequenceB.value = '';
  result.value = null;
  error.value = null;
}

// Check if interaction is favorable
const isFavorable = computed(() => {
  if (!result.value) return null;
  return result.value.interactionEnergy < 0;
});
</script>

<template>
  <div class="rnacofold-app">
    <header class="app-header">
      <h1>RNAcofold</h1>
      <p class="subtitle">RNA-RNA Cofolding</p>
      <p class="description">
        Predicts the minimum free energy structure of two interacting RNA molecules,
        considering both intra- and inter-molecular base pairs.
      </p>
    </header>

    <main class="app-main">
      <section class="input-section">
        <h2>Input Sequences</h2>

        <div class="dual-input">
          <div class="input-group">
            <label>Sequence A (5' → 3'):</label>
            <textarea
              v-model="sequenceA"
              placeholder="Enter first RNA sequence"
              rows="2"
              :disabled="isProcessing"
            ></textarea>
            <span class="validation" :class="{ valid: validationA.valid, invalid: !validationA.valid && validationA.message }">
              {{ validationA.message }}
            </span>
          </div>

          <div class="input-group">
            <label>Sequence B (5' → 3'):</label>
            <textarea
              v-model="sequenceB"
              placeholder="Enter second RNA sequence"
              rows="2"
              :disabled="isProcessing"
            ></textarea>
            <span class="validation" :class="{ valid: validationB.valid, invalid: !validationB.valid && validationB.message }">
              {{ validationB.message }}
            </span>
          </div>
        </div>

        <div class="examples">
          <span class="examples-label">Examples:</span>
          <button
            v-for="example in examples"
            :key="example.name"
            class="example-btn"
            @click="loadExample(example)"
          >
            {{ example.name }}
          </button>
        </div>

        <div class="actions">
          <button
            class="btn primary"
            @click="runCofold"
            :disabled="!canFold || isProcessing"
          >
            <span v-if="isProcessing" class="spinner"></span>
            {{ isProcessing ? 'Folding...' : 'Cofold RNAs' }}
          </button>
          <button class="btn secondary" @click="clearAll" :disabled="isProcessing">
            Clear
          </button>
        </div>
      </section>

      <div v-if="error" class="error-message">
        <strong>Error:</strong> {{ error }}
      </div>

      <section v-if="result" class="results-section">
        <h2>Cofolding Results</h2>

        <!-- Energy Summary -->
        <div class="energy-summary">
          <div class="energy-box total">
            <span class="energy-label">Total MFE</span>
            <span class="energy-value">{{ result.mfe.toFixed(2) }}</span>
            <span class="energy-unit">kcal/mol</span>
          </div>

          <div class="energy-box intra-a">
            <span class="energy-label">Intra A</span>
            <span class="energy-value">{{ result.intraMfeA.toFixed(2) }}</span>
            <span class="energy-unit">kcal/mol</span>
          </div>

          <div class="energy-box intra-b">
            <span class="energy-label">Intra B</span>
            <span class="energy-value">{{ result.intraMfeB.toFixed(2) }}</span>
            <span class="energy-unit">kcal/mol</span>
          </div>

          <div class="energy-box interaction" :class="{ favorable: isFavorable, unfavorable: isFavorable === false }">
            <span class="energy-label">Interaction</span>
            <span class="energy-value">{{ result.interactionEnergy.toFixed(2) }}</span>
            <span class="energy-unit">kcal/mol</span>
          </div>
        </div>

        <!-- Structure Display -->
        <div class="structure-display">
          <h3>Combined Structure</h3>
          <div class="combined-structure">
            <div class="seq-row">
              <span class="seq-label">A:</span>
              <span class="seq-content">{{ result.sequenceA }}</span>
            </div>
            <div class="struct-row">
              <span class="seq-label"></span>
              <span class="struct-content">{{ result.structureA }}</span>
            </div>
            <div class="separator">& (cut point)</div>
            <div class="seq-row">
              <span class="seq-label">B:</span>
              <span class="seq-content">{{ result.sequenceB }}</span>
            </div>
            <div class="struct-row">
              <span class="seq-label"></span>
              <span class="struct-content">{{ result.structureB }}</span>
            </div>
          </div>
        </div>

        <!-- Base Pairs Summary -->
        <div class="pairs-summary">
          <div class="pairs-box inter">
            <span class="pairs-count">{{ result.interMolecularPairs.length }}</span>
            <span class="pairs-label">Intermolecular pairs</span>
          </div>
          <div class="pairs-box intra-a">
            <span class="pairs-count">{{ result.intraMolecularPairsA.length }}</span>
            <span class="pairs-label">Intramolecular A</span>
          </div>
          <div class="pairs-box intra-b">
            <span class="pairs-count">{{ result.intraMolecularPairsB.length }}</span>
            <span class="pairs-label">Intramolecular B</span>
          </div>
        </div>

        <!-- Intermolecular Pairs Detail -->
        <details v-if="result.interMolecularPairs.length > 0" class="pairs-details">
          <summary>Intermolecular Base Pairs</summary>
          <div class="pairs-list">
            <span v-for="([i, j], idx) in result.interMolecularPairs" :key="idx" class="pair-item">
              A:{{ i }} - B:{{ j - result.sequenceA.length }}
            </span>
          </div>
        </details>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rnacofold-app {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.app-header {
  text-align: center;
  margin-bottom: 30px;
}

.app-header h1 {
  font-size: 2.5rem;
  margin: 0;
  background: linear-gradient(135deg, #45B7D1, #96E6A1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.subtitle {
  font-size: 1.2rem;
  color: #888;
  margin: 5px 0;
}

.description {
  color: #666;
  font-size: 0.9rem;
}

.input-section, .results-section {
  background: #1e1e2e;
  padding: 25px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.input-section h2, .results-section h2 {
  margin-top: 0;
  color: #e0e0e0;
  font-size: 1.2rem;
}

.dual-input {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

@media (max-width: 700px) {
  .dual-input {
    grid-template-columns: 1fr;
  }
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.input-group label {
  color: #aaa;
  font-size: 0.9rem;
}

textarea {
  width: 100%;
  padding: 12px;
  border: 2px solid #333;
  border-radius: 8px;
  background: #0d0d1a;
  color: #e0e0e0;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  resize: vertical;
}

textarea:focus {
  outline: none;
  border-color: #45B7D1;
}

.validation {
  font-size: 0.8rem;
}

.validation.valid { color: #4ECDC4; }
.validation.invalid { color: #FF6B6B; }

.examples {
  margin: 15px 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.examples-label {
  color: #888;
  font-size: 0.9rem;
}

.example-btn {
  padding: 5px 12px;
  border: 1px solid #444;
  border-radius: 15px;
  background: transparent;
  color: #aaa;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.example-btn:hover {
  border-color: #45B7D1;
  color: #45B7D1;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn.primary {
  background: linear-gradient(135deg, #45B7D1, #96E6A1);
  color: #1a1a2e;
  font-weight: 600;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(69, 183, 209, 0.4);
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.secondary {
  background: #333;
  color: #e0e0e0;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #00000040;
  border-top-color: #000000;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-message {
  background: #ff6b6b20;
  border: 1px solid #FF6B6B;
  color: #FF6B6B;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.energy-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
  margin-bottom: 25px;
}

@media (max-width: 700px) {
  .energy-summary {
    grid-template-columns: repeat(2, 1fr);
  }
}

.energy-box {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
  border: 2px solid transparent;
}

.energy-box.total {
  border-color: #45B7D1;
}

.energy-box.intra-a {
  border-color: #7B68EE;
}

.energy-box.intra-b {
  border-color: #96E6A1;
}

.energy-box.interaction {
  border-color: #FFD93D;
}

.energy-box.interaction.favorable {
  border-color: #4ECDC4;
  background: #4ECDC410;
}

.energy-box.interaction.unfavorable {
  border-color: #FF6B6B;
  background: #FF6B6B10;
}

.energy-label {
  display: block;
  color: #888;
  font-size: 0.8rem;
  margin-bottom: 5px;
}

.energy-value {
  display: block;
  font-size: 1.4rem;
  font-weight: bold;
  color: #e0e0e0;
}

.energy-unit {
  display: block;
  color: #666;
  font-size: 0.75rem;
}

.structure-display {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.structure-display h3 {
  margin: 0 0 15px 0;
  color: #e0e0e0;
  font-size: 1rem;
}

.combined-structure {
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
}

.seq-row, .struct-row {
  display: flex;
  gap: 10px;
  margin: 2px 0;
}

.seq-label {
  width: 20px;
  color: #888;
  font-weight: bold;
}

.seq-content {
  color: #e0e0e0;
  letter-spacing: 1px;
}

.struct-content {
  color: #7B68EE;
  letter-spacing: 1px;
}

.separator {
  color: #666;
  font-size: 0.8rem;
  margin: 8px 0;
  padding-left: 30px;
}

.pairs-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 15px;
  margin-bottom: 20px;
}

.pairs-box {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.pairs-box.inter {
  border-left: 3px solid #FF6B6B;
}

.pairs-box.intra-a {
  border-left: 3px solid #7B68EE;
}

.pairs-box.intra-b {
  border-left: 3px solid #96E6A1;
}

.pairs-count {
  display: block;
  font-size: 1.5rem;
  font-weight: bold;
  color: #e0e0e0;
}

.pairs-label {
  color: #888;
  font-size: 0.8rem;
}

.pairs-details {
  background: #0d0d1a;
  border-radius: 8px;
  overflow: hidden;
}

.pairs-details summary {
  padding: 12px 15px;
  cursor: pointer;
  color: #aaa;
}

.pairs-list {
  padding: 15px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pair-item {
  padding: 4px 10px;
  background: #1e1e2e;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.85rem;
  color: #FF6B6B;
}
</style>
