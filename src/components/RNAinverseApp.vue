<script setup lang="ts">
import { ref, computed } from 'vue';
import { inverse, inverseMultiple, validateStructure, type InverseResult } from '../lib/rnainverse';
import DotBracketViewer from './DotBracketViewer.vue';

// Input
const targetStructure = ref('');
const maxIterations = ref(1000);
const maxAttempts = ref(10);
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<InverseResult | null>(null);
const multipleResults = ref<InverseResult[]>([]);

// Mode
const mode = ref<'single' | 'multiple'>('single');
const designCount = ref(5);

// Examples
const examples = [
  { name: 'Hairpin', structure: '((((....))))' },
  { name: 'Stem-loop', structure: '((((...))))' },
  { name: 'Multi-loop', structure: '(((..(((....)))..(((...)))..)))' },
  { name: 'Two hairpins', structure: '((((....))))....((((....))))' }
];

// Validation
const structureValidation = computed(() => {
  const struct = targetStructure.value.trim();
  if (!struct) return { valid: false, message: '' };

  const validation = validateStructure(struct);
  if (!validation.valid) {
    return { valid: false, message: validation.error || 'Invalid structure' };
  }

  // Count pairs
  const pairs = (struct.match(/\(/g) || []).length;
  return { valid: true, message: `${struct.length} nt, ${pairs} base pairs` };
});

// Run inverse folding
async function runInverse() {
  if (!structureValidation.value.valid) return;

  error.value = null;
  result.value = null;
  multipleResults.value = [];
  isProcessing.value = true;

  try {
    await new Promise(resolve => setTimeout(resolve, 10));

    if (mode.value === 'single') {
      result.value = inverse(targetStructure.value, {
        maxIterations: maxIterations.value,
        maxAttempts: maxAttempts.value
      });
    } else {
      multipleResults.value = inverseMultiple(
        targetStructure.value,
        designCount.value,
        {
          maxIterations: maxIterations.value,
          maxAttempts: Math.ceil(maxAttempts.value / 2)
        }
      );
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'RNA design failed';
  } finally {
    isProcessing.value = false;
  }
}

// Load example
function loadExample(struct: string) {
  targetStructure.value = struct;
  result.value = null;
  multipleResults.value = [];
  error.value = null;
}

// Clear
function clearAll() {
  targetStructure.value = '';
  result.value = null;
  multipleResults.value = [];
  error.value = null;
}

// Copy sequence
async function copySequence(seq: string) {
  await navigator.clipboard.writeText(seq);
}
</script>

<template>
  <div class="rnainverse-app">
    <header class="app-header">
      <h1>RNAinverse</h1>
      <p class="subtitle">RNA Sequence Design</p>
      <p class="description">
        Designs RNA sequences that fold into a target secondary structure using
        adaptive walk optimization.
      </p>
    </header>

    <main class="app-main">
      <section class="input-section">
        <h2>Target Structure</h2>

        <div class="input-group">
          <textarea
            v-model="targetStructure"
            placeholder="Enter target structure in dot-bracket notation&#10;e.g., ((((....))))"
            rows="3"
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
            @click="loadExample(example.structure)"
          >
            {{ example.name }}
          </button>
        </div>

        <!-- Mode Toggle -->
        <div class="mode-toggle">
          <button
            :class="{ active: mode === 'single' }"
            @click="mode = 'single'"
          >
            Single Design
          </button>
          <button
            :class="{ active: mode === 'multiple' }"
            @click="mode = 'multiple'"
          >
            Multiple Designs
          </button>
        </div>

        <!-- Parameters -->
        <div class="parameters">
          <div class="param-group">
            <label>Max Iterations:</label>
            <input
              type="number"
              v-model.number="maxIterations"
              min="100"
              max="10000"
              step="100"
              :disabled="isProcessing"
            />
          </div>

          <div class="param-group">
            <label>Max Attempts:</label>
            <input
              type="number"
              v-model.number="maxAttempts"
              min="1"
              max="50"
              :disabled="isProcessing"
            />
          </div>

          <div v-if="mode === 'multiple'" class="param-group">
            <label>Number of Designs:</label>
            <input
              type="number"
              v-model.number="designCount"
              min="2"
              max="10"
              :disabled="isProcessing"
            />
          </div>
        </div>

        <div class="actions">
          <button
            class="btn primary"
            @click="runInverse"
            :disabled="!structureValidation.valid || isProcessing"
          >
            <span v-if="isProcessing" class="spinner"></span>
            {{ isProcessing ? 'Designing...' : 'Design Sequence' }}
          </button>
          <button class="btn secondary" @click="clearAll" :disabled="isProcessing">
            Clear
          </button>
        </div>
      </section>

      <div v-if="error" class="error-message">
        <strong>Error:</strong> {{ error }}
      </div>

      <!-- Single Result -->
      <section v-if="result && mode === 'single'" class="results-section">
        <h2>Design Result</h2>

        <!-- Status -->
        <div class="status-display" :class="{ success: result.success, partial: !result.success }">
          <span class="status-icon">{{ result.success ? '✓' : '!' }}</span>
          <span class="status-text">{{ result.success ? 'Exact match found' : 'Partial match (structure differs)' }}</span>
        </div>

        <!-- Designed Sequence -->
        <div class="sequence-display">
          <div class="seq-header">
            <h3>Designed Sequence</h3>
            <button class="copy-btn" @click="copySequence(result.designedSequence)">
              Copy
            </button>
          </div>
          <div class="sequence-box">
            {{ result.designedSequence }}
          </div>
        </div>

        <!-- Structure Comparison -->
        <div class="comparison">
          <div class="comparison-row">
            <span class="comp-label">Target:</span>
            <code class="comp-struct">{{ result.targetStructure }}</code>
          </div>
          <div class="comparison-row">
            <span class="comp-label">Actual:</span>
            <code class="comp-struct" :class="{ match: result.success, mismatch: !result.success }">
              {{ result.actualStructure }}
            </code>
          </div>
        </div>

        <!-- Stats -->
        <div class="stats-grid">
          <div class="stat-box">
            <span class="stat-value">{{ result.targetEnergy.toFixed(2) }}</span>
            <span class="stat-label">Energy (kcal/mol)</span>
          </div>
          <div class="stat-box">
            <span class="stat-value">{{ result.distance }}</span>
            <span class="stat-label">Distance</span>
          </div>
          <div class="stat-box">
            <span class="stat-value">{{ result.iterations }}</span>
            <span class="stat-label">Iterations</span>
          </div>
          <div class="stat-box">
            <span class="stat-value">{{ result.attempts }}</span>
            <span class="stat-label">Attempts</span>
          </div>
        </div>

        <!-- Structure Preview -->
        <div class="structure-preview">
          <DotBracketViewer
            :sequence="result.designedSequence"
            :structure="result.actualStructure"
          />
        </div>
      </section>

      <!-- Multiple Results -->
      <section v-if="multipleResults.length > 0 && mode === 'multiple'" class="results-section">
        <h2>Multiple Designs ({{ multipleResults.length }} found)</h2>

        <div class="designs-list">
          <div
            v-for="(res, index) in multipleResults"
            :key="index"
            class="design-card"
            :class="{ success: res.success }"
          >
            <div class="design-header">
              <span class="design-num">#{{ index + 1 }}</span>
              <span class="design-status">{{ res.success ? '✓' : '!' }}</span>
              <span class="design-energy">{{ res.targetEnergy.toFixed(2) }} kcal/mol</span>
              <button class="copy-btn small" @click="copySequence(res.designedSequence)">
                Copy
              </button>
            </div>
            <div class="design-sequence">
              {{ res.designedSequence }}
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.rnainverse-app {
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
  background: linear-gradient(135deg, #00BFA5, #00897B);
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
  border-color: #00BFA5;
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
  border-color: #00BFA5;
  color: #00BFA5;
}

.mode-toggle {
  display: flex;
  gap: 8px;
  margin: 20px 0;
}

.mode-toggle button {
  padding: 10px 20px;
  border: 1px solid #444;
  border-radius: 8px;
  background: transparent;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-toggle button:hover:not(.active) {
  border-color: #666;
  color: #aaa;
}

.mode-toggle button.active {
  background: #00BFA5;
  border-color: #00BFA5;
  color: white;
}

.parameters {
  display: flex;
  gap: 20px;
  margin: 20px 0;
  flex-wrap: wrap;
}

.param-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.param-group label {
  color: #aaa;
  font-size: 0.85rem;
}

.param-group input {
  padding: 8px 12px;
  border: 2px solid #333;
  border-radius: 6px;
  background: #0d0d1a;
  color: #e0e0e0;
  width: 120px;
}

.param-group input:focus {
  outline: none;
  border-color: #00BFA5;
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
  background: linear-gradient(135deg, #00BFA5, #00897B);
  color: white;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0, 191, 165, 0.4);
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

.status-display {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 15px 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.status-display.success {
  background: #00BFA520;
  border: 1px solid #00BFA5;
}

.status-display.partial {
  background: #FFD93D20;
  border: 1px solid #FFD93D;
}

.status-icon {
  font-size: 1.2rem;
}

.status-display.success .status-icon {
  color: #00BFA5;
}

.status-display.partial .status-icon {
  color: #FFD93D;
}

.status-text {
  color: #e0e0e0;
}

.sequence-display {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.seq-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.seq-header h3 {
  margin: 0;
  color: #e0e0e0;
  font-size: 1rem;
}

.copy-btn {
  padding: 6px 12px;
  border: 1px solid #444;
  border-radius: 4px;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.2s;
}

.copy-btn:hover {
  border-color: #00BFA5;
  color: #00BFA5;
}

.copy-btn.small {
  padding: 4px 8px;
  font-size: 0.75rem;
}

.sequence-box {
  font-family: 'Courier New', monospace;
  font-size: 1rem;
  color: #00BFA5;
  word-break: break-all;
  letter-spacing: 1px;
}

.comparison {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.comparison-row {
  display: flex;
  gap: 10px;
  margin: 5px 0;
  align-items: center;
}

.comp-label {
  width: 60px;
  color: #888;
  font-size: 0.9rem;
}

.comp-struct {
  font-family: 'Courier New', monospace;
  color: #e0e0e0;
  letter-spacing: 1px;
}

.comp-struct.match {
  color: #00BFA5;
}

.comp-struct.mismatch {
  color: #FF6B6B;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 15px;
  margin-bottom: 20px;
}

@media (max-width: 600px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.stat-box {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.stat-value {
  display: block;
  font-size: 1.3rem;
  font-weight: bold;
  color: #e0e0e0;
}

.stat-label {
  color: #888;
  font-size: 0.8rem;
}

.structure-preview {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
}

.designs-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.design-card {
  background: #0d0d1a;
  padding: 15px;
  border-radius: 8px;
  border-left: 3px solid #444;
}

.design-card.success {
  border-left-color: #00BFA5;
}

.design-header {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 10px;
}

.design-num {
  font-weight: bold;
  color: #e0e0e0;
}

.design-status {
  font-size: 0.9rem;
}

.design-card.success .design-status {
  color: #00BFA5;
}

.design-energy {
  color: #888;
  font-size: 0.85rem;
}

.design-sequence {
  font-family: 'Courier New', monospace;
  color: #00BFA5;
  word-break: break-all;
  letter-spacing: 1px;
}
</style>
