<script setup lang="ts">
import { ref, computed } from 'vue';
import { duplex, type DuplexResult } from '../lib/rnaduplex';
import { cleanSequence, isValidSequence } from '../lib/rnafold';

// Input
const sequenceA = ref('');
const sequenceB = ref('');
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<DuplexResult | null>(null);

// Examples
const examples = [
  {
    name: 'Perfect match',
    seqA: 'GGGGGGGGGG',
    seqB: 'CCCCCCCCCC'
  },
  {
    name: 'siRNA-like',
    seqA: 'ACGUGACACGUUCGGAGAAUU',
    seqB: 'UUCUCCGAACGUGUCACGUUU'
  },
  {
    name: 'miRNA seed',
    seqA: 'UAGCAGCACGUAAAUAUUGGCG',
    seqB: 'UUUUAAUAUUUACGUGCUGCU'
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

const canPredict = computed(() => {
  return validationA.value.valid && validationB.value.valid;
});

// Run duplex
async function runDuplex() {
  if (!canPredict.value) return;

  error.value = null;
  result.value = null;
  isProcessing.value = true;

  try {
    await new Promise(resolve => setTimeout(resolve, 10));
    result.value = duplex(sequenceA.value, sequenceB.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Duplex prediction failed';
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

// Get binding strength description
const bindingStrength = computed(() => {
  if (!result.value) return null;
  const energy = result.value.energy;
  if (energy >= 0) return { level: 'none', text: 'No stable duplex' };
  if (energy > -5) return { level: 'weak', text: 'Weak binding' };
  if (energy > -10) return { level: 'moderate', text: 'Moderate binding' };
  if (energy > -20) return { level: 'strong', text: 'Strong binding' };
  return { level: 'very-strong', text: 'Very strong binding' };
});
</script>

<template>
  <div class="rnaduplex-app">
    <header class="app-header">
      <h1>RNAduplex</h1>
      <p class="subtitle">RNA-RNA Interaction Prediction</p>
      <p class="description">
        Predicts hybridization between two RNA molecules. Only intermolecular base pairs
        are considered (no intramolecular folding).
      </p>
    </header>

    <main class="app-main">
      <section class="input-section">
        <h2>Input Sequences</h2>

        <div class="dual-input">
          <div class="input-group">
            <label>Sequence A (query, 5' → 3'):</label>
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
            <label>Sequence B (target, 5' → 3'):</label>
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
            @click="runDuplex"
            :disabled="!canPredict || isProcessing"
          >
            <span v-if="isProcessing" class="spinner"></span>
            {{ isProcessing ? 'Predicting...' : 'Predict Duplex' }}
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
        <h2>Duplex Prediction Results</h2>

        <!-- Energy and Binding Strength -->
        <div class="energy-display">
          <div class="energy-main">
            <span class="energy-label">Hybridization Energy</span>
            <span class="energy-value" :class="{ negative: result.energy < 0 }">
              {{ result.energy.toFixed(2) }} kcal/mol
            </span>
          </div>
          <div v-if="bindingStrength" class="binding-strength" :class="bindingStrength.level">
            {{ bindingStrength.text }}
          </div>
        </div>

        <!-- No duplex message -->
        <div v-if="result.basePairs.length === 0" class="no-duplex">
          <p>No stable duplex found between the two sequences.</p>
          <p class="hint">Try sequences with more complementary regions.</p>
        </div>

        <!-- Duplex Visualization -->
        <div v-else class="duplex-view">
          <h3>Duplex Structure</h3>

          <!-- Interaction Region -->
          <div class="interaction-region">
            <div class="region-info">
              <span class="region-label">A:</span>
              <span class="region-pos">positions {{ result.startA }} - {{ result.endA }}</span>
            </div>
            <div class="region-info">
              <span class="region-label">B:</span>
              <span class="region-pos">positions {{ result.startB }} - {{ result.endB }}</span>
            </div>
          </div>

          <!-- ASCII Art Duplex -->
          <div class="duplex-ascii">
            <div class="strand strand-a">
              <span class="direction">5'</span>
              <span class="sequence">{{ result.sequenceA.substring(result.startA - 1, result.endA) }}</span>
              <span class="direction">3'</span>
            </div>
            <div class="pairs-line">
              <span class="spacer"></span>
              <span class="pairs">
                {{ result.structureA.substring(result.startA - 1, result.endA).split('').map(c => c === '(' ? '|' : ' ').join('') }}
              </span>
            </div>
            <div class="strand strand-b">
              <span class="direction">3'</span>
              <span class="sequence">{{ result.sequenceB.substring(result.startB - 1, result.endB).split('').reverse().join('') }}</span>
              <span class="direction">5'</span>
            </div>
          </div>

          <!-- Base Pairs Detail -->
          <div class="pairs-detail">
            <h4>Base Pairs ({{ result.basePairs.length }})</h4>
            <div class="pairs-list">
              <div v-for="(pair, idx) in result.basePairs" :key="idx" class="pair-item">
                <span class="pair-pos">{{ pair.posA }}</span>
                <span class="pair-bases">
                  {{ result.sequenceA[pair.posA - 1] }} - {{ result.sequenceB[pair.posB - 1] }}
                </span>
                <span class="pair-pos">{{ pair.posB }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rnaduplex-app {
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
  background: linear-gradient(135deg, #E040FB, #7C4DFF);
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
  border-color: #E040FB;
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
  border-color: #E040FB;
  color: #E040FB;
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
  background: linear-gradient(135deg, #E040FB, #7C4DFF);
  color: white;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(224, 64, 251, 0.4);
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
  border: 2px solid #ffffff40;
  border-top-color: #ffffff;
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

.energy-display {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 15px;
}

.energy-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.energy-label {
  color: #888;
  font-size: 0.9rem;
}

.energy-value {
  font-size: 1.8rem;
  font-weight: bold;
  color: #888;
}

.energy-value.negative {
  color: #4ECDC4;
}

.binding-strength {
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 600;
}

.binding-strength.none {
  background: #44444440;
  color: #888;
}

.binding-strength.weak {
  background: #FFD93D20;
  color: #FFD93D;
}

.binding-strength.moderate {
  background: #4ECDC420;
  color: #4ECDC4;
}

.binding-strength.strong {
  background: #7C4DFF20;
  color: #7C4DFF;
}

.binding-strength.very-strong {
  background: #E040FB20;
  color: #E040FB;
}

.no-duplex {
  background: #0d0d1a;
  padding: 30px;
  border-radius: 8px;
  text-align: center;
}

.no-duplex p {
  margin: 0;
  color: #888;
}

.no-duplex .hint {
  margin-top: 10px;
  font-size: 0.85rem;
  color: #666;
}

.duplex-view {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
}

.duplex-view h3 {
  margin: 0 0 15px 0;
  color: #e0e0e0;
  font-size: 1rem;
}

.interaction-region {
  display: flex;
  gap: 30px;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #333;
}

.region-info {
  display: flex;
  gap: 8px;
}

.region-label {
  color: #888;
  font-weight: 600;
}

.region-pos {
  color: #e0e0e0;
}

.duplex-ascii {
  font-family: 'Courier New', monospace;
  background: #1e1e2e;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  overflow-x: auto;
}

.strand {
  display: flex;
  gap: 10px;
  align-items: center;
  white-space: nowrap;
}

.strand .direction {
  color: #666;
  font-size: 0.8rem;
  width: 20px;
}

.strand .sequence {
  letter-spacing: 2px;
}

.strand-a .sequence {
  color: #E040FB;
}

.strand-b .sequence {
  color: #7C4DFF;
}

.pairs-line {
  display: flex;
  gap: 10px;
}

.pairs-line .spacer {
  width: 20px;
}

.pairs-line .pairs {
  letter-spacing: 2px;
  color: #4ECDC4;
}

.pairs-detail {
  margin-top: 20px;
}

.pairs-detail h4 {
  margin: 0 0 10px 0;
  color: #aaa;
  font-size: 0.9rem;
}

.pairs-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.pair-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  background: #1e1e2e;
  border-radius: 6px;
  font-family: monospace;
  font-size: 0.85rem;
}

.pair-pos {
  color: #888;
}

.pair-bases {
  color: #E040FB;
  font-weight: 600;
}
</style>
