<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { fold, isValidSequence, cleanSequence, type FoldResult } from '../lib/rnafold';
import { foldWasm, preloadWasm, isWasmLoaded, type WasmFoldResult } from '../lib/rnafold-wasm';
import RNAStructureViewer from './RNAStructureViewer.vue';
import DotBracketViewer from './DotBracketViewer.vue';
import ForceGraphViewer from './ForceGraphViewer.vue';
import ArcDiagramViewer from './ArcDiagramViewer.vue';

// Input sequence
const inputSequence = ref('');
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<FoldResult | null>(null);
const wasmResult = ref<WasmFoldResult | null>(null);
const computationTime = ref<number>(0);
const wasmComputationTime = ref<number>(0);

// Implementation mode
type ImplementationMode = 'typescript' | 'wasm' | 'compare';
const implementationMode = ref<ImplementationMode>('typescript');
const wasmLoaded = ref(false);
const wasmLoadError = ref<string | null>(null);

// Example sequences
const exampleSequences = [
  {
    name: 'tRNA (76nt)',
    sequence: 'GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA'
  },
  {
    name: 'Hairpin (30nt)',
    sequence: 'GGGGAAAACCCCGGGGUUUUAAAACCCC'
  },
  {
    name: 'miRNA precursor (70nt)',
    sequence: 'UGAGGUAGUAGGUUGUAUAGUUUUAGGGUCACACCCACCACUGGGAGAUAACUAUACAAUCUACUGUCUUUCC'
  },
  {
    name: 'Simple stem-loop (20nt)',
    sequence: 'GCGCAAAAGCGCUUUUGCGC'
  }
];

// Current view mode
type ViewMode = 'dot-bracket' | 'circle' | 'force' | 'arc';
const viewMode = ref<ViewMode>('dot-bracket');

// View mode options
const viewModes: Array<{ id: ViewMode; label: string; icon: string }> = [
  { id: 'dot-bracket', label: 'Dot-Bracket', icon: '( )' },
  { id: 'arc', label: 'Arc Diagram', icon: '⌒' },
  { id: 'force', label: 'Force Graph', icon: '◉' },
  { id: 'circle', label: 'Circle Plot', icon: '○' },
];

// Cleaned sequence for display
const cleanedSequence = computed(() => {
  return cleanSequence(inputSequence.value);
});

// Sequence validation
const sequenceValidation = computed(() => {
  const seq = inputSequence.value.trim();
  if (!seq) return { valid: false, message: '' };

  const cleaned = cleanSequence(seq);
  if (cleaned.length === 0) {
    return { valid: false, message: 'Please enter a valid RNA sequence' };
  }

  if (!isValidSequence(seq)) {
    return { valid: false, message: 'Sequence contains invalid characters. Use only A, U, G, C (or T).' };
  }

  if (cleaned.length > 500) {
    return { valid: true, message: `Warning: Long sequences (${cleaned.length}nt) may take longer to compute.` };
  }

  return { valid: true, message: `Valid sequence: ${cleaned.length} nucleotides` };
});

// Check if results match
const resultsMatch = computed(() => {
  if (!result.value || !wasmResult.value) return null;
  return result.value.structure === wasmResult.value.structure;
});

// Speedup factor
const speedupFactor = computed(() => {
  if (!computationTime.value || !wasmComputationTime.value) return null;
  return (computationTime.value / wasmComputationTime.value).toFixed(2);
});

// Preload WASM module
onMounted(async () => {
  try {
    preloadWasm();
    // Check loading state periodically
    const checkLoaded = setInterval(() => {
      if (isWasmLoaded()) {
        wasmLoaded.value = true;
        clearInterval(checkLoaded);
      }
    }, 100);
    // Timeout after 10s
    setTimeout(() => {
      clearInterval(checkLoaded);
      if (!wasmLoaded.value) {
        wasmLoadError.value = 'WASM module failed to load';
      }
    }, 10000);
  } catch (e) {
    wasmLoadError.value = e instanceof Error ? e.message : 'Failed to load WASM module';
  }
});

// Fold the RNA sequence
async function foldSequence() {
  if (!sequenceValidation.value.valid || !inputSequence.value.trim()) {
    return;
  }

  error.value = null;
  result.value = null;
  wasmResult.value = null;
  isProcessing.value = true;

  try {
    // Use setTimeout to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));

    if (implementationMode.value === 'typescript' || implementationMode.value === 'compare') {
      const startTime = performance.now();
      result.value = fold(inputSequence.value);
      computationTime.value = Math.round(performance.now() - startTime);
    }

    if (implementationMode.value === 'wasm' || implementationMode.value === 'compare') {
      const wasmRes = await foldWasm(inputSequence.value);
      wasmResult.value = wasmRes;
      wasmComputationTime.value = Math.round(wasmRes.computeTime);
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'An error occurred during folding';
    result.value = null;
    wasmResult.value = null;
  } finally {
    isProcessing.value = false;
  }
}

// Load example sequence
function loadExample(seq: string) {
  inputSequence.value = seq;
  result.value = null;
  wasmResult.value = null;
  error.value = null;
}

// Clear all
function clearAll() {
  inputSequence.value = '';
  result.value = null;
  wasmResult.value = null;
  error.value = null;
}

// Copy result to clipboard
async function copyResult() {
  const res = result.value || wasmResult.value;
  if (!res) return;

  const text = `>RNA_sequence
${res.sequence}
${res.structure} (${res.mfe.toFixed(2)} kcal/mol)`;

  await navigator.clipboard.writeText(text);
}

// Download result
function downloadResult() {
  const res = result.value || wasmResult.value;
  if (!res) return;

  const text = `>RNA_sequence
${res.sequence}
${res.structure} (${res.mfe.toFixed(2)} kcal/mol)

Base pairs: ${res.basePairs.map(([i, j]) => `(${i},${j})`).join(' ')}
`;

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rnafold_result.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// Current result to display
const displayResult = computed(() => {
  if (implementationMode.value === 'wasm') return wasmResult.value;
  return result.value;
});
</script>

<template>
  <div class="rnafold-app">
    <!-- Header -->
    <header class="app-header">
      <h1>RNAfold</h1>
      <p class="subtitle">RNA Secondary Structure Prediction</p>
      <p class="description">
        TypeScript and WebAssembly implementations based on ViennaRNA package.
        Predicts minimum free energy (MFE) secondary structures using Zuker's algorithm.
      </p>
    </header>

    <!-- Main content -->
    <main class="app-main">
      <!-- Input section -->
      <section class="input-section">
        <h2>Input Sequence</h2>

        <div class="textarea-wrapper">
          <textarea
            v-model="inputSequence"
            placeholder="Enter RNA sequence (e.g., GCGCAAAAGCGC)&#10;Accepts A, U, G, C nucleotides&#10;T will be converted to U"
            rows="4"
            :disabled="isProcessing"
          ></textarea>
          <span class="char-count">{{ cleanedSequence.length }} nt</span>
        </div>

        <div
          class="validation-message"
          :class="{
            'valid': sequenceValidation.valid && sequenceValidation.message,
            'invalid': !sequenceValidation.valid && sequenceValidation.message,
            'warning': sequenceValidation.message?.startsWith('Warning')
          }"
        >
          {{ sequenceValidation.message }}
        </div>

        <!-- Example sequences -->
        <div class="examples">
          <span class="examples-label">Examples:</span>
          <button
            v-for="example in exampleSequences"
            :key="example.name"
            class="example-btn"
            @click="loadExample(example.sequence)"
          >
            {{ example.name }}
          </button>
        </div>

        <!-- Implementation mode toggle -->
        <div class="impl-mode-section">
          <span class="impl-label">Implementation:</span>
          <div class="impl-toggle">
            <button
              :class="{ active: implementationMode === 'typescript' }"
              @click="implementationMode = 'typescript'"
            >
              TypeScript
            </button>
            <button
              :class="{ active: implementationMode === 'wasm', disabled: !wasmLoaded }"
              @click="wasmLoaded && (implementationMode = 'wasm')"
              :disabled="!wasmLoaded"
              :title="wasmLoaded ? 'Use WebAssembly implementation' : 'Loading WASM module...'"
            >
              WebAssembly
              <span v-if="!wasmLoaded" class="wasm-loading">(loading...)</span>
            </button>
            <button
              :class="{ active: implementationMode === 'compare', disabled: !wasmLoaded }"
              @click="wasmLoaded && (implementationMode = 'compare')"
              :disabled="!wasmLoaded"
              :title="wasmLoaded ? 'Compare both implementations' : 'Loading WASM module...'"
            >
              Compare
            </button>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="actions">
          <button
            class="btn primary"
            @click="foldSequence"
            :disabled="!sequenceValidation.valid || isProcessing || !inputSequence.trim()"
          >
            <span v-if="isProcessing" class="spinner"></span>
            {{ isProcessing ? 'Folding...' : 'Fold RNA' }}
          </button>
          <button class="btn secondary" @click="clearAll" :disabled="isProcessing">
            Clear
          </button>
        </div>
      </section>

      <!-- Error display -->
      <div v-if="error" class="error-message">
        <strong>Error:</strong> {{ error }}
      </div>

      <!-- Comparison Results -->
      <section v-if="implementationMode === 'compare' && result && wasmResult" class="comparison-section">
        <h2>Comparison Results</h2>

        <div class="comparison-grid">
          <!-- TypeScript Result -->
          <div class="comparison-card ts-card">
            <h3>TypeScript</h3>
            <div class="result-stats">
              <div class="stat">
                <span class="stat-label">MFE:</span>
                <span class="stat-value">{{ result.mfe.toFixed(2) }} kcal/mol</span>
              </div>
              <div class="stat">
                <span class="stat-label">Time:</span>
                <span class="stat-value time">{{ computationTime }} ms</span>
              </div>
              <div class="stat">
                <span class="stat-label">Base pairs:</span>
                <span class="stat-value">{{ result.basePairs.length }}</span>
              </div>
            </div>
            <div class="structure-preview">
              <code>{{ result.structure.substring(0, 50) }}{{ result.structure.length > 50 ? '...' : '' }}</code>
            </div>
          </div>

          <!-- WASM Result -->
          <div class="comparison-card wasm-card">
            <h3>WebAssembly</h3>
            <div class="result-stats">
              <div class="stat">
                <span class="stat-label">MFE:</span>
                <span class="stat-value">{{ wasmResult.mfe.toFixed(2) }} kcal/mol</span>
              </div>
              <div class="stat">
                <span class="stat-label">Time:</span>
                <span class="stat-value time">{{ wasmComputationTime }} ms</span>
              </div>
              <div class="stat">
                <span class="stat-label">Base pairs:</span>
                <span class="stat-value">{{ wasmResult.basePairs.length }}</span>
              </div>
            </div>
            <div class="structure-preview">
              <code>{{ wasmResult.structure.substring(0, 50) }}{{ wasmResult.structure.length > 50 ? '...' : '' }}</code>
            </div>
          </div>
        </div>

        <!-- Comparison Summary -->
        <div class="comparison-summary">
          <div class="summary-item" :class="{ match: resultsMatch, mismatch: resultsMatch === false }">
            <span class="summary-label">Structures:</span>
            <span class="summary-value">{{ resultsMatch ? 'Match' : 'Different' }}</span>
          </div>
          <div class="summary-item" v-if="speedupFactor">
            <span class="summary-label">WASM Speedup:</span>
            <span class="summary-value speedup">{{ speedupFactor }}x {{ Number(speedupFactor) > 1 ? 'faster' : 'slower' }}</span>
          </div>
          <div class="summary-item" v-if="result.mfe !== wasmResult.mfe">
            <span class="summary-label">MFE Difference:</span>
            <span class="summary-value">{{ Math.abs(result.mfe - wasmResult.mfe).toFixed(4) }} kcal/mol</span>
          </div>
        </div>
      </section>

      <!-- Results section -->
      <section v-if="displayResult && implementationMode !== 'compare'" class="results-section">
        <h2>Results <span class="impl-badge">{{ implementationMode === 'wasm' ? 'WebAssembly' : 'TypeScript' }}</span></h2>

        <!-- MFE display -->
        <div class="mfe-display">
          <div class="mfe-value">
            <span class="label">Minimum Free Energy:</span>
            <span class="value">{{ displayResult.mfe.toFixed(2) }} kcal/mol</span>
          </div>
          <div class="stats">
            <span>Length: {{ displayResult.sequence.length }} nt</span>
            <span>Base pairs: {{ displayResult.basePairs.length }}</span>
            <span>Computation time: {{ implementationMode === 'wasm' ? wasmComputationTime : computationTime }} ms</span>
          </div>
        </div>

        <!-- View mode toggle -->
        <div class="view-toggle">
          <button
            v-for="mode in viewModes"
            :key="mode.id"
            :class="{ active: viewMode === mode.id }"
            @click="viewMode = mode.id"
            :title="mode.label"
          >
            <span class="mode-icon">{{ mode.icon }}</span>
            <span class="mode-label">{{ mode.label }}</span>
          </button>
        </div>

        <!-- Structure visualization -->
        <div class="structure-view">
          <DotBracketViewer
            v-if="viewMode === 'dot-bracket'"
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
          />
          <ArcDiagramViewer
            v-else-if="viewMode === 'arc'"
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
            :base-pairs="displayResult.basePairs"
          />
          <ForceGraphViewer
            v-else-if="viewMode === 'force'"
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
            :base-pairs="displayResult.basePairs"
          />
          <RNAStructureViewer
            v-else
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
            :base-pairs="displayResult.basePairs"
          />
        </div>

        <!-- Export actions -->
        <div class="export-actions">
          <button class="btn secondary" @click="copyResult">
            Copy to Clipboard
          </button>
          <button class="btn secondary" @click="downloadResult">
            Download Result
          </button>
        </div>

        <!-- Base pairs list -->
        <details class="base-pairs-details">
          <summary>Base Pairs ({{ displayResult.basePairs.length }})</summary>
          <div class="base-pairs-list">
            <span
              v-for="([i, j], index) in displayResult.basePairs"
              :key="index"
              class="bp-item"
            >
              {{ displayResult.sequence[i-1] }}{{ i }}-{{ displayResult.sequence[j-1] }}{{ j }}
            </span>
          </div>
        </details>
      </section>

      <!-- Visualization for compare mode -->
      <section v-if="implementationMode === 'compare' && displayResult" class="results-section">
        <h2>Structure Visualization <span class="impl-badge">TypeScript Result</span></h2>

        <!-- View mode toggle -->
        <div class="view-toggle">
          <button
            v-for="mode in viewModes"
            :key="mode.id"
            :class="{ active: viewMode === mode.id }"
            @click="viewMode = mode.id"
            :title="mode.label"
          >
            <span class="mode-icon">{{ mode.icon }}</span>
            <span class="mode-label">{{ mode.label }}</span>
          </button>
        </div>

        <!-- Structure visualization -->
        <div class="structure-view">
          <DotBracketViewer
            v-if="viewMode === 'dot-bracket'"
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
          />
          <ArcDiagramViewer
            v-else-if="viewMode === 'arc'"
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
            :base-pairs="displayResult.basePairs"
          />
          <ForceGraphViewer
            v-else-if="viewMode === 'force'"
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
            :base-pairs="displayResult.basePairs"
          />
          <RNAStructureViewer
            v-else
            :sequence="displayResult.sequence"
            :structure="displayResult.structure"
            :base-pairs="displayResult.basePairs"
          />
        </div>

        <!-- Export actions -->
        <div class="export-actions">
          <button class="btn secondary" @click="copyResult">
            Copy to Clipboard
          </button>
          <button class="btn secondary" @click="downloadResult">
            Download Result
          </button>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="app-footer">
      <p>
        Based on <a href="https://github.com/ViennaRNA/ViennaRNA" target="_blank">ViennaRNA Package</a>.
        Implements Zuker's algorithm for MFE structure prediction.
      </p>
      <p class="tech-stack">
        Built with Vue 3 + TypeScript + WebAssembly
      </p>
    </footer>
  </div>
</template>

<style scoped>
.rnafold-app {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.app-header {
  text-align: center;
  margin-bottom: 30px;
}

.app-header h1 {
  font-size: 2.5rem;
  margin: 0;
  background: linear-gradient(135deg, #7B68EE, #4ECDC4);
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
  max-width: 600px;
  margin: 10px auto;
}

/* Main */
.app-main {
  flex: 1;
}

/* Input section */
.input-section {
  background: #1e1e2e;
  padding: 25px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.input-section h2 {
  margin-top: 0;
  color: #e0e0e0;
  font-size: 1.2rem;
}

.textarea-wrapper {
  position: relative;
}

textarea {
  width: 100%;
  padding: 15px;
  border: 2px solid #333;
  border-radius: 8px;
  background: #0d0d1a;
  color: #e0e0e0;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  resize: vertical;
  transition: border-color 0.2s;
}

textarea:focus {
  outline: none;
  border-color: #7B68EE;
}

textarea:disabled {
  opacity: 0.6;
}

.char-count {
  position: absolute;
  bottom: 10px;
  right: 10px;
  color: #666;
  font-size: 12px;
}

.validation-message {
  margin-top: 8px;
  font-size: 0.85rem;
  min-height: 20px;
}

.validation-message.valid {
  color: #4ECDC4;
}

.validation-message.invalid {
  color: #FF6B6B;
}

.validation-message.warning {
  color: #FFD93D;
}

/* Examples */
.examples {
  margin-top: 15px;
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
  border-color: #7B68EE;
  color: #7B68EE;
}

/* Implementation mode toggle */
.impl-mode-section {
  margin-top: 20px;
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}

.impl-label {
  color: #888;
  font-size: 0.9rem;
}

.impl-toggle {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.impl-toggle button {
  padding: 8px 16px;
  border: 1px solid #444;
  border-radius: 8px;
  background: transparent;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9rem;
}

.impl-toggle button:hover:not(.active):not(.disabled) {
  border-color: #666;
  color: #aaa;
}

.impl-toggle button.active {
  background: #7B68EE;
  border-color: #7B68EE;
  color: white;
}

.impl-toggle button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wasm-loading {
  font-size: 0.75rem;
  opacity: 0.7;
}

/* Actions */
.actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
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
  background: linear-gradient(135deg, #7B68EE, #5B4BC4);
  color: white;
}

.btn.primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(123, 104, 238, 0.4);
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

/* Spinner */
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

/* Error */
.error-message {
  background: #ff6b6b20;
  border: 1px solid #FF6B6B;
  color: #FF6B6B;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

/* Comparison section */
.comparison-section {
  background: #1e1e2e;
  padding: 25px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.comparison-section h2 {
  margin-top: 0;
  color: #e0e0e0;
  font-size: 1.2rem;
}

.comparison-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 20px;
}

@media (max-width: 700px) {
  .comparison-grid {
    grid-template-columns: 1fr;
  }
}

.comparison-card {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
  border: 2px solid transparent;
}

.comparison-card h3 {
  margin: 0 0 15px 0;
  font-size: 1rem;
  color: #e0e0e0;
}

.ts-card {
  border-color: #7B68EE;
}

.ts-card h3 {
  color: #7B68EE;
}

.wasm-card {
  border-color: #4ECDC4;
}

.wasm-card h3 {
  color: #4ECDC4;
}

.result-stats {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  color: #888;
  font-size: 0.85rem;
}

.stat-value {
  color: #e0e0e0;
  font-weight: 600;
}

.stat-value.time {
  color: #FFD93D;
}

.structure-preview {
  margin-top: 15px;
  padding: 10px;
  background: #1e1e2e;
  border-radius: 4px;
  overflow-x: auto;
}

.structure-preview code {
  font-family: 'Courier New', monospace;
  font-size: 0.8rem;
  color: #aaa;
}

.comparison-summary {
  display: flex;
  gap: 25px;
  flex-wrap: wrap;
  padding: 15px 20px;
  background: #0d0d1a;
  border-radius: 8px;
}

.summary-item {
  display: flex;
  gap: 10px;
  align-items: center;
}

.summary-label {
  color: #888;
  font-size: 0.9rem;
}

.summary-value {
  color: #e0e0e0;
  font-weight: 600;
}

.summary-item.match .summary-value {
  color: #4ECDC4;
}

.summary-item.mismatch .summary-value {
  color: #FF6B6B;
}

.summary-value.speedup {
  color: #FFD93D;
}

/* Results section */
.results-section {
  background: #1e1e2e;
  padding: 25px;
  border-radius: 12px;
  margin-bottom: 20px;
}

.results-section h2 {
  margin-top: 0;
  color: #e0e0e0;
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  gap: 10px;
}

.impl-badge {
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: 12px;
  background: #7B68EE;
  color: white;
  font-weight: normal;
}

/* MFE display */
.mfe-display {
  background: #0d0d1a;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.mfe-value {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.mfe-value .label {
  color: #888;
}

.mfe-value .value {
  font-size: 1.5rem;
  font-weight: bold;
  color: #4ECDC4;
}

.stats {
  display: flex;
  gap: 20px;
  color: #666;
  font-size: 0.9rem;
}

/* View toggle */
.view-toggle {
  display: flex;
  gap: 8px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.view-toggle button {
  padding: 8px 16px;
  border: 1px solid #444;
  border-radius: 8px;
  background: transparent;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.view-toggle button:hover:not(.active) {
  border-color: #666;
  color: #aaa;
}

.view-toggle button.active {
  background: #7B68EE;
  border-color: #7B68EE;
  color: white;
}

.view-toggle .mode-icon {
  font-size: 1rem;
}

.view-toggle .mode-label {
  font-size: 0.85rem;
}

@media (max-width: 600px) {
  .view-toggle .mode-label {
    display: none;
  }
}

/* Structure view */
.structure-view {
  margin-bottom: 20px;
}

/* Export actions */
.export-actions {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

/* Base pairs details */
.base-pairs-details {
  background: #0d0d1a;
  border-radius: 8px;
  overflow: hidden;
}

.base-pairs-details summary {
  padding: 12px 15px;
  cursor: pointer;
  color: #aaa;
  user-select: none;
}

.base-pairs-details summary:hover {
  background: #151525;
}

.base-pairs-list {
  padding: 15px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.bp-item {
  padding: 4px 10px;
  background: #1e1e2e;
  border-radius: 4px;
  font-family: monospace;
  font-size: 0.85rem;
  color: #7B68EE;
}

/* Footer */
.app-footer {
  text-align: center;
  padding: 20px;
  color: #666;
  font-size: 0.85rem;
  margin-top: auto;
}

.app-footer a {
  color: #7B68EE;
  text-decoration: none;
}

.app-footer a:hover {
  text-decoration: underline;
}

.tech-stack {
  margin-top: 5px;
  font-size: 0.75rem;
}
</style>
