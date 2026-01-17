<script setup lang="ts">
import { ref, computed } from 'vue';
import { subopt, type SuboptResult } from '../lib/rnasubopt';
import { cleanSequence, isValidSequence } from '../lib/rnafold';
import DotBracketViewer from './DotBracketViewer.vue';

// Input
const inputSequence = ref('');
const deltaEnergy = ref(5);
const maxStructures = ref(20);
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<SuboptResult | null>(null);

// Selected structure for viewing
const selectedIndex = ref(0);

// Example sequences
const examples = [
  { name: 'Hairpin (20nt)', sequence: 'GCGCAAAAGCGCUUUUGCGC' },
  { name: 'Stem-loop (28nt)', sequence: 'GGGGAAAACCCCGGGGUUUUAAAACCCC' },
  { name: 'Simple (12nt)', sequence: 'GCGCAAAAGCGC' }
];

// Validation
const sequenceValidation = computed(() => {
  const seq = inputSequence.value.trim();
  if (!seq) return { valid: false, message: '' };

  const cleaned = cleanSequence(seq);
  if (!isValidSequence(seq)) {
    return { valid: false, message: 'Invalid characters in sequence' };
  }

  if (cleaned.length > 100) {
    return { valid: true, message: `Warning: Long sequences (${cleaned.length}nt) may generate many structures` };
  }

  return { valid: true, message: `${cleaned.length} nucleotides` };
});

// Run subopt
async function runSubopt() {
  if (!sequenceValidation.value.valid) return;

  error.value = null;
  result.value = null;
  selectedIndex.value = 0;
  isProcessing.value = true;

  try {
    await new Promise(resolve => setTimeout(resolve, 10));
    result.value = subopt(inputSequence.value, {
      deltaEnergy: deltaEnergy.value,
      maxStructures: maxStructures.value
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Suboptimal folding failed';
  } finally {
    isProcessing.value = false;
  }
}

// Load example
function loadExample(seq: string) {
  inputSequence.value = seq;
  result.value = null;
  error.value = null;
}

// Clear
function clearAll() {
  inputSequence.value = '';
  result.value = null;
  error.value = null;
  selectedIndex.value = 0;
}

// Selected structure
const selectedStructure = computed(() => {
  if (!result.value || result.value.structures.length === 0) return null;
  return result.value.structures[selectedIndex.value];
});

// Energy relative to MFE
function energyDiff(energy: number): string {
  if (!result.value) return '';
  const diff = energy - result.value.mfeEnergy;
  if (diff === 0) return 'MFE';
  return `+${diff.toFixed(2)}`;
}
</script>

<template>
  <div class="rnasubopt-app">
    <header class="app-header">
      <h1>RNAsubopt</h1>
      <p class="subtitle">Suboptimal Structure Prediction</p>
      <p class="description">
        Generates suboptimal RNA secondary structures within a specified energy range from the MFE.
      </p>
    </header>

    <main class="app-main">
      <section class="input-section">
        <h2>Input Sequence</h2>

        <div class="input-group">
          <textarea
            v-model="inputSequence"
            placeholder="Enter RNA sequence (A, U, G, C)"
            rows="3"
            :disabled="isProcessing"
          ></textarea>
          <span class="validation" :class="{ valid: sequenceValidation.valid, invalid: !sequenceValidation.valid && sequenceValidation.message }">
            {{ sequenceValidation.message }}
          </span>
        </div>

        <div class="examples">
          <span class="examples-label">Examples:</span>
          <button
            v-for="example in examples"
            :key="example.name"
            class="example-btn"
            @click="loadExample(example.sequence)"
          >
            {{ example.name }}
          </button>
        </div>

        <!-- Parameters -->
        <div class="parameters">
          <div class="param-group">
            <label>Energy Range (kcal/mol):</label>
            <input
              type="number"
              v-model.number="deltaEnergy"
              min="0.1"
              max="20"
              step="0.5"
              :disabled="isProcessing"
            />
            <span class="param-hint">Structures within this range above MFE</span>
          </div>

          <div class="param-group">
            <label>Max Structures:</label>
            <input
              type="number"
              v-model.number="maxStructures"
              min="1"
              max="100"
              step="1"
              :disabled="isProcessing"
            />
            <span class="param-hint">Maximum number of structures to generate</span>
          </div>
        </div>

        <div class="actions">
          <button
            class="btn primary"
            @click="runSubopt"
            :disabled="!sequenceValidation.valid || isProcessing || !inputSequence.trim()"
          >
            <span v-if="isProcessing" class="spinner"></span>
            {{ isProcessing ? 'Computing...' : 'Find Suboptimal Structures' }}
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
        <h2>Suboptimal Structures</h2>

        <!-- Summary -->
        <div class="summary">
          <div class="summary-item">
            <span class="label">MFE:</span>
            <span class="value mfe">{{ result.mfeEnergy.toFixed(2) }} kcal/mol</span>
          </div>
          <div class="summary-item">
            <span class="label">Found:</span>
            <span class="value">{{ result.structures.length }} structures</span>
          </div>
          <div class="summary-item">
            <span class="label">Range:</span>
            <span class="value">{{ deltaEnergy }} kcal/mol</span>
          </div>
        </div>

        <!-- Structure List -->
        <div class="structure-list-container">
          <div class="structure-list">
            <button
              v-for="(struct, index) in result.structures"
              :key="index"
              :class="['structure-item', { selected: selectedIndex === index, mfe: index === 0 }]"
              @click="selectedIndex = index"
            >
              <span class="struct-index">#{{ index + 1 }}</span>
              <span class="struct-energy">{{ struct.energy.toFixed(2) }}</span>
              <span class="struct-diff" :class="{ mfe: energyDiff(struct.energy) === 'MFE' }">
                {{ energyDiff(struct.energy) }}
              </span>
              <span class="struct-pairs">{{ struct.basePairs.length }} bp</span>
            </button>
          </div>
        </div>

        <!-- Selected Structure View -->
        <div v-if="selectedStructure" class="selected-structure">
          <div class="selected-header">
            <h3>Structure #{{ selectedIndex + 1 }}</h3>
            <span class="selected-energy">
              {{ selectedStructure.energy.toFixed(2) }} kcal/mol
              <span class="diff">({{ energyDiff(selectedStructure.energy) }})</span>
            </span>
          </div>

          <DotBracketViewer
            :sequence="result.sequence"
            :structure="selectedStructure.structure"
          />

          <div class="base-pairs-info">
            <strong>Base pairs:</strong>
            {{ selectedStructure.basePairs.map(([i, j]) => `${i}-${j}`).join(', ') || 'None' }}
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rnasubopt-app {
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
  background: linear-gradient(135deg, #FFD93D, #FF6B6B);
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

.input-group {
  margin-bottom: 15px;
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
  border-color: #FFD93D;
}

.validation {
  font-size: 0.8rem;
  margin-top: 4px;
  display: block;
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
  border-color: #FFD93D;
  color: #FFD93D;
}

.parameters {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 20px 0;
}

@media (max-width: 600px) {
  .parameters {
    grid-template-columns: 1fr;
  }
}

.param-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.param-group label {
  color: #aaa;
  font-size: 0.9rem;
}

.param-group input {
  padding: 10px;
  border: 2px solid #333;
  border-radius: 6px;
  background: #0d0d1a;
  color: #e0e0e0;
  font-size: 1rem;
}

.param-group input:focus {
  outline: none;
  border-color: #FFD93D;
}

.param-hint {
  color: #666;
  font-size: 0.75rem;
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
  background: linear-gradient(135deg, #FFD93D, #FF6B6B);
  color: #1a1a2e;
  font-weight: 600;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(255, 217, 61, 0.4);
}

.btn.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn.secondary {
  background: #333;
  color: #e0e0e0;
}

.btn.secondary:hover:not(:disabled) {
  background: #444;
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

.summary {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
  background: #0d0d1a;
  padding: 15px 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.summary-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.summary-item .label {
  color: #888;
}

.summary-item .value {
  color: #e0e0e0;
  font-weight: 600;
}

.summary-item .value.mfe {
  color: #FFD93D;
}

.structure-list-container {
  margin-bottom: 20px;
}

.structure-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px;
  background: #0d0d1a;
  border-radius: 8px;
}

.structure-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid #333;
  border-radius: 6px;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.85rem;
}

.structure-item:hover {
  border-color: #666;
  background: #1e1e2e;
}

.structure-item.selected {
  border-color: #FFD93D;
  background: #FFD93D20;
  color: #FFD93D;
}

.structure-item.mfe .struct-diff {
  color: #FFD93D;
  font-weight: bold;
}

.struct-index {
  font-weight: 600;
}

.struct-energy {
  color: #888;
}

.struct-diff {
  color: #666;
  font-size: 0.8rem;
}

.struct-diff.mfe {
  color: #FFD93D;
}

.struct-pairs {
  color: #666;
  font-size: 0.8rem;
}

.selected-structure {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
}

.selected-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.selected-header h3 {
  margin: 0;
  color: #e0e0e0;
}

.selected-energy {
  color: #FFD93D;
  font-weight: 600;
}

.selected-energy .diff {
  color: #888;
  font-weight: normal;
}

.base-pairs-info {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #333;
  color: #888;
  font-size: 0.85rem;
  font-family: monospace;
}
</style>
