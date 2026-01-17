<script setup lang="ts">
import { ref, computed } from 'vue';
import { evaluate, type EvalResult } from '../lib/rnaeval';
import { cleanSequence, isValidSequence } from '../lib/rnafold';
import DotBracketViewer from './DotBracketViewer.vue';

// Input
const inputSequence = ref('');
const inputStructure = ref('');
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<EvalResult | null>(null);

// Example sequences
const examples = [
  {
    name: 'Hairpin',
    sequence: 'GCGCAAAAGCGC',
    structure: '((((....))))'
  },
  {
    name: 'Stem-loop',
    sequence: 'GGGGAAAACCCC',
    structure: '((((....))))'
  },
  {
    name: 'Multi-loop',
    sequence: 'GCGCAAAAGCGCUUUUGCGCAAAAGCGC',
    structure: '((((....))))....((((....))))'
  },
  {
    name: 'Complex',
    sequence: 'GGGAAAUCCCGGGAAAUCCC',
    structure: '(((...)))(((...)))'
  }
];

// Validation
const sequenceValidation = computed(() => {
  const seq = inputSequence.value.trim();
  if (!seq) return { valid: false, message: '' };

  const cleaned = cleanSequence(seq);
  if (!isValidSequence(seq)) {
    return { valid: false, message: 'Invalid nucleotides in sequence' };
  }
  return { valid: true, message: `${cleaned.length} nucleotides` };
});

const structureValidation = computed(() => {
  const struct = inputStructure.value.trim();
  if (!struct) return { valid: false, message: '' };

  const seq = cleanSequence(inputSequence.value);
  if (struct.length !== seq.length) {
    return { valid: false, message: `Length mismatch: structure (${struct.length}) vs sequence (${seq.length})` };
  }

  // Check balanced brackets
  let depth = 0;
  for (const c of struct) {
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth < 0) return { valid: false, message: 'Unbalanced: too many closing brackets' };
    } else if (c !== '.') {
      return { valid: false, message: `Invalid character: '${c}'` };
    }
  }
  if (depth !== 0) return { valid: false, message: 'Unbalanced: too many opening brackets' };

  return { valid: true, message: 'Valid structure' };
});

const canEvaluate = computed(() => {
  return sequenceValidation.value.valid && structureValidation.value.valid;
});

// Evaluate structure
async function evaluateStructure() {
  if (!canEvaluate.value) return;

  error.value = null;
  result.value = null;
  isProcessing.value = true;

  try {
    await new Promise(resolve => setTimeout(resolve, 10));
    result.value = evaluate(inputSequence.value, inputStructure.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Evaluation failed';
  } finally {
    isProcessing.value = false;
  }
}

// Load example
function loadExample(example: typeof examples[0]) {
  inputSequence.value = example.sequence;
  inputStructure.value = example.structure;
  result.value = null;
  error.value = null;
}

// Clear
function clearAll() {
  inputSequence.value = '';
  inputStructure.value = '';
  result.value = null;
  error.value = null;
}

// Color for energy type
function getEnergyColor(type: string): string {
  const colors: Record<string, string> = {
    stack: '#4ECDC4',
    hairpin: '#7B68EE',
    bulge: '#FFD93D',
    internal: '#FF6B6B',
    multiloop: '#45B7D1',
    external: '#98D8C8'
  };
  return colors[type] || '#888';
}
</script>

<template>
  <div class="rnaeval-app">
    <header class="app-header">
      <h1>RNAeval</h1>
      <p class="subtitle">Structure Energy Evaluation</p>
      <p class="description">
        Calculates the free energy of an RNA secondary structure with detailed decomposition by loop type.
      </p>
    </header>

    <main class="app-main">
      <section class="input-section">
        <h2>Input</h2>

        <div class="input-group">
          <label>RNA Sequence:</label>
          <textarea
            v-model="inputSequence"
            placeholder="Enter RNA sequence (A, U, G, C)"
            rows="2"
            :disabled="isProcessing"
          ></textarea>
          <span class="validation" :class="{ valid: sequenceValidation.valid, invalid: !sequenceValidation.valid && sequenceValidation.message }">
            {{ sequenceValidation.message }}
          </span>
        </div>

        <div class="input-group">
          <label>Secondary Structure (dot-bracket):</label>
          <textarea
            v-model="inputStructure"
            placeholder="Enter structure in dot-bracket notation (e.g., (((...))))"
            rows="2"
            :disabled="isProcessing"
          ></textarea>
          <span class="validation" :class="{ valid: structureValidation.valid, invalid: !structureValidation.valid && structureValidation.message }">
            {{ structureValidation.message }}
          </span>
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
            @click="evaluateStructure"
            :disabled="!canEvaluate || isProcessing"
          >
            <span v-if="isProcessing" class="spinner"></span>
            {{ isProcessing ? 'Evaluating...' : 'Evaluate Energy' }}
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
        <h2>Energy Evaluation Results</h2>

        <!-- Total Energy -->
        <div class="total-energy">
          <span class="label">Total Free Energy:</span>
          <span class="value">{{ result.totalEnergy.toFixed(2) }} kcal/mol</span>
        </div>

        <!-- Structure View -->
        <div class="structure-preview">
          <DotBracketViewer
            :sequence="result.sequence"
            :structure="result.structure"
          />
        </div>

        <!-- Energy Breakdown -->
        <div class="energy-breakdown">
          <h3>Energy by Loop Type</h3>
          <div class="energy-bars">
            <div
              v-for="(energy, type) in result.energyByType"
              :key="type"
              v-show="energy !== 0"
              class="energy-bar-item"
            >
              <div class="bar-label">
                <span class="type-name">{{ type }}</span>
                <span class="type-energy">{{ energy.toFixed(2) }} kcal/mol</span>
              </div>
              <div class="bar-container">
                <div
                  class="bar-fill"
                  :style="{
                    width: `${Math.abs(energy) / Math.max(...Object.values(result.energyByType).map(Math.abs)) * 100}%`,
                    backgroundColor: getEnergyColor(type)
                  }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Detailed Loop Contributions -->
        <details class="loop-details">
          <summary>Detailed Loop Contributions ({{ result.loopEnergies.length }})</summary>
          <div class="loop-list">
            <div
              v-for="(loop, index) in result.loopEnergies"
              :key="index"
              class="loop-item"
            >
              <div class="loop-header">
                <span
                  class="loop-type"
                  :style="{ backgroundColor: getEnergyColor(loop.type) }"
                >
                  {{ loop.type }}
                </span>
                <span class="loop-pos">[{{ loop.i }}-{{ loop.j }}]</span>
                <span class="loop-energy">{{ loop.energy.toFixed(2) }} kcal/mol</span>
              </div>
              <div v-if="loop.details" class="loop-details-text">
                {{ loop.details }}
              </div>
            </div>
          </div>
        </details>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rnaeval-app {
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
  background: linear-gradient(135deg, #4ECDC4, #45B7D1);
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

.input-group label {
  display: block;
  color: #aaa;
  margin-bottom: 5px;
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
  border-color: #4ECDC4;
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
  border-color: #4ECDC4;
  color: #4ECDC4;
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
  background: linear-gradient(135deg, #4ECDC4, #45B7D1);
  color: white;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(78, 205, 196, 0.4);
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

.total-energy {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.total-energy .label {
  color: #888;
  font-size: 1rem;
}

.total-energy .value {
  font-size: 1.8rem;
  font-weight: bold;
  color: #4ECDC4;
}

.structure-preview {
  margin-bottom: 20px;
}

.energy-breakdown {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.energy-breakdown h3 {
  margin: 0 0 15px 0;
  color: #e0e0e0;
  font-size: 1rem;
}

.energy-bars {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.energy-bar-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}

.type-name {
  color: #aaa;
  text-transform: capitalize;
}

.type-energy {
  color: #e0e0e0;
  font-weight: 600;
}

.bar-container {
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.loop-details {
  background: #0d0d1a;
  border-radius: 8px;
  overflow: hidden;
}

.loop-details summary {
  padding: 12px 15px;
  cursor: pointer;
  color: #aaa;
  user-select: none;
}

.loop-details summary:hover {
  background: #151525;
}

.loop-list {
  padding: 15px;
  max-height: 300px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.loop-item {
  background: #1e1e2e;
  padding: 10px;
  border-radius: 6px;
}

.loop-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.loop-type {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  color: white;
  text-transform: capitalize;
}

.loop-pos {
  color: #666;
  font-family: monospace;
  font-size: 0.85rem;
}

.loop-energy {
  margin-left: auto;
  color: #e0e0e0;
  font-weight: 600;
}

.loop-details-text {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #333;
  color: #888;
  font-size: 0.8rem;
}
</style>
