<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { fold, isValidSequence, cleanSequence, type FoldResult } from '../lib/rnafold';
import RNAStructureViewer from './RNAStructureViewer.vue';
import DotBracketViewer from './DotBracketViewer.vue';
import ArcDiagramViewer from './ArcDiagramViewer.vue';

// Current active tool
type ToolType = 'RNAfold' | 'RNAcofold' | 'RNAalifold' | 'RNAplfold' | 'RNAup';
const activeTool = ref<ToolType>('RNAfold');

// ViennaRNA tools list
const viennaTools = [
  { id: 'RNAfold' as ToolType, name: 'RNAfold', description: 'Secondary structure prediction', available: true },
  { id: 'RNAcofold' as ToolType, name: 'RNAcofold', description: 'RNA-RNA interaction', available: false },
  { id: 'RNAalifold' as ToolType, name: 'RNAalifold', description: 'Consensus structure', available: false },
  { id: 'RNAplfold' as ToolType, name: 'RNAplfold', description: 'Local folding', available: false },
  { id: 'RNAup' as ToolType, name: 'RNAup', description: 'Accessibility prediction', available: false },
];

// Input sequence
const inputSequence = ref('');
const isProcessing = ref(false);
const error = ref<string | null>(null);
const result = ref<FoldResult | null>(null);
const computationTime = ref<number>(0);

// RNAfold parameters
const foldParams = ref({
  temperature: 37,
  dangles: 2,
  noLP: false,
  noGU: false,
  noClosingGU: false,
  noTetra: false,
});

// Parameter descriptions
const paramDescriptions = {
  temperature: 'Folding temperature in Celsius',
  dangles: 'Dangling end treatment (0=none, 1=unpaired only, 2=all)',
  noLP: 'Disallow lonely base pairs',
  noGU: 'Disallow G-U wobble pairs',
  noClosingGU: 'Disallow G-U pairs at helix ends',
  noTetra: 'Disable special tetraloop bonuses',
};

// Example sequences
const exampleSequences = [
  {
    name: 'tRNA (76nt)',
    sequence: 'GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA'
  },
  {
    name: 'Hairpin (28nt)',
    sequence: 'GGGGAAAACCCCGGGGUUUUAAAACCCC'
  },
  {
    name: 'miRNA precursor (70nt)',
    sequence: 'UGAGGUAGUAGGUUGUAUAGUUUUAGGGUCACACCCACCACUGGGAGAUAACUAUACAAUCUACUGUCUUUCC'
  },
  {
    name: 'Stem-loop (20nt)',
    sequence: 'GCGCAAAAGCGCUUUUGCGC'
  }
];

// Current view mode
type ViewMode = 'dot-bracket' | 'circle' | 'arc';
const viewMode = ref<ViewMode>('dot-bracket');

// View mode options (Force Graph removed)
const viewModes: Array<{ id: ViewMode; label: string; icon: string }> = [
  { id: 'dot-bracket', label: 'Dot-Bracket', icon: '( )' },
  { id: 'arc', label: 'Arc Diagram', icon: '~' },
  { id: 'circle', label: 'Circle Plot', icon: 'O' },
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

// Reset result when parameters change
watch(foldParams, () => {
  // Could trigger re-fold if desired
}, { deep: true });

// Fold the RNA sequence
async function foldSequence() {
  if (!sequenceValidation.value.valid || !inputSequence.value.trim()) {
    return;
  }

  error.value = null;
  result.value = null;
  isProcessing.value = true;

  try {
    // Use setTimeout to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 10));

    const startTime = performance.now();
    result.value = fold(inputSequence.value, {
      temperature: foldParams.value.temperature,
      dangles: foldParams.value.dangles,
      noLP: foldParams.value.noLP,
      noGU: foldParams.value.noGU,
      noClosingGU: foldParams.value.noClosingGU,
      noTetra: foldParams.value.noTetra,
    });
    computationTime.value = Math.round(performance.now() - startTime);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'An error occurred during folding';
    result.value = null;
  } finally {
    isProcessing.value = false;
  }
}

// Load example sequence
function loadExample(seq: string) {
  inputSequence.value = seq;
  result.value = null;
  error.value = null;
}

// Clear all
function clearAll() {
  inputSequence.value = '';
  result.value = null;
  error.value = null;
}

// Copy result to clipboard
async function copyResult() {
  if (!result.value) return;

  const text = `>${inputSequence.value.trim().substring(0, 20)}...
${result.value.sequence}
${result.value.structure} (${result.value.mfe.toFixed(2)} kcal/mol)`;

  await navigator.clipboard.writeText(text);
}

// Download result
function downloadResult() {
  if (!result.value) return;

  const text = `>RNA_sequence
${result.value.sequence}
${result.value.structure} (${result.value.mfe.toFixed(2)} kcal/mol)

Base pairs: ${result.value.basePairs.map(([i, j]) => `(${i},${j})`).join(' ')}

Parameters:
Temperature: ${foldParams.value.temperature}C
Dangles: ${foldParams.value.dangles}
noLP: ${foldParams.value.noLP}
noGU: ${foldParams.value.noGU}
`;

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rnafold_result.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// Format command line
const commandLine = computed(() => {
  let cmd = 'RNAfold';
  if (foldParams.value.temperature !== 37) cmd += ` -T ${foldParams.value.temperature}`;
  if (foldParams.value.dangles !== 2) cmd += ` -d${foldParams.value.dangles}`;
  if (foldParams.value.noLP) cmd += ' --noLP';
  if (foldParams.value.noGU) cmd += ' --noGU';
  if (foldParams.value.noClosingGU) cmd += ' --noClosingGU';
  if (foldParams.value.noTetra) cmd += ' -4';
  cmd += ' --noPS';
  return cmd;
});
</script>

<template>
  <div class="app-layout">
    <!-- Left Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>ViennaRNA</h2>
        <p class="version">Web Tools</p>
      </div>

      <nav class="tool-nav">
        <button
          v-for="tool in viennaTools"
          :key="tool.id"
          class="tool-btn"
          :class="{ active: activeTool === tool.id, disabled: !tool.available }"
          @click="tool.available && (activeTool = tool.id)"
          :disabled="!tool.available"
        >
          <span class="tool-name">{{ tool.name }}</span>
          <span class="tool-desc">{{ tool.description }}</span>
          <span v-if="!tool.available" class="coming-soon">Soon</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <a href="https://github.com/ViennaRNA/ViennaRNA" target="_blank">
          ViennaRNA Package
        </a>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Header -->
      <header class="app-header">
        <h1>{{ activeTool }}</h1>
        <p class="subtitle">
          {{ activeTool === 'RNAfold' ? 'RNA Secondary Structure Prediction' : 'Coming Soon' }}
        </p>
      </header>

      <!-- RNAfold Content -->
      <div v-if="activeTool === 'RNAfold'" class="rnafold-content">
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
        </section>

        <!-- Parameters section -->
        <section class="params-section">
          <h2>Parameters</h2>

          <div class="params-grid">
            <div class="param-item">
              <label for="temperature">
                Temperature (C)
                <span class="param-hint">{{ paramDescriptions.temperature }}</span>
              </label>
              <input
                id="temperature"
                type="number"
                v-model.number="foldParams.temperature"
                min="0"
                max="100"
                step="1"
              />
            </div>

            <div class="param-item">
              <label for="dangles">
                Dangles
                <span class="param-hint">{{ paramDescriptions.dangles }}</span>
              </label>
              <select id="dangles" v-model.number="foldParams.dangles">
                <option :value="0">0 - None</option>
                <option :value="1">1 - Unpaired only</option>
                <option :value="2">2 - All (default)</option>
              </select>
            </div>

            <div class="param-item checkbox">
              <label>
                <input type="checkbox" v-model="foldParams.noLP" />
                No lonely pairs (--noLP)
              </label>
            </div>

            <div class="param-item checkbox">
              <label>
                <input type="checkbox" v-model="foldParams.noGU" />
                No G-U pairs (--noGU)
              </label>
            </div>

            <div class="param-item checkbox">
              <label>
                <input type="checkbox" v-model="foldParams.noClosingGU" />
                No closing G-U (--noClosingGU)
              </label>
            </div>

            <div class="param-item checkbox">
              <label>
                <input type="checkbox" v-model="foldParams.noTetra" />
                No tetraloop bonus (-4)
              </label>
            </div>
          </div>

          <div class="command-preview">
            <span class="cmd-label">Equivalent command:</span>
            <code>{{ commandLine }}</code>
          </div>
        </section>

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

        <!-- Error display -->
        <div v-if="error" class="error-message">
          <strong>Error:</strong> {{ error }}
        </div>

        <!-- Results section -->
        <section v-if="result" class="results-section">
          <h2>Results</h2>

          <!-- MFE display -->
          <div class="mfe-display">
            <div class="mfe-value">
              <span class="label">Minimum Free Energy:</span>
              <span class="value">{{ result.mfe.toFixed(2) }} kcal/mol</span>
            </div>
            <div class="stats">
              <span>Length: {{ result.sequence.length }} nt</span>
              <span>Base pairs: {{ result.basePairs.length }}</span>
              <span>Time: {{ computationTime }} ms</span>
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
              :sequence="result.sequence"
              :structure="result.structure"
            />
            <ArcDiagramViewer
              v-else-if="viewMode === 'arc'"
              :sequence="result.sequence"
              :structure="result.structure"
              :base-pairs="result.basePairs"
            />
            <RNAStructureViewer
              v-else
              :sequence="result.sequence"
              :structure="result.structure"
              :base-pairs="result.basePairs"
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
            <summary>Base Pairs ({{ result.basePairs.length }})</summary>
            <div class="base-pairs-list">
              <span
                v-for="([i, j], index) in result.basePairs"
                :key="index"
                class="bp-item"
              >
                {{ result.sequence[i-1] }}{{ i }}-{{ result.sequence[j-1] }}{{ j }}
              </span>
            </div>
          </details>
        </section>
      </div>

      <!-- Placeholder for other tools -->
      <div v-else class="tool-placeholder">
        <h2>{{ activeTool }}</h2>
        <p>This tool is coming soon.</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  min-height: 100vh;
  background: #0d0d1a;
}

/* Sidebar */
.sidebar {
  width: 220px;
  background: #1a1a2e;
  border-right: 1px solid #333;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 20px;
  border-bottom: 1px solid #333;
}

.sidebar-header h2 {
  margin: 0;
  font-size: 1.3rem;
  background: linear-gradient(135deg, #7B68EE, #4ECDC4);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sidebar-header .version {
  margin: 5px 0 0;
  font-size: 0.8rem;
  color: #666;
}

.tool-nav {
  flex: 1;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.tool-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 15px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #aaa;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  position: relative;
}

.tool-btn:hover:not(.disabled) {
  background: #252540;
  color: #e0e0e0;
}

.tool-btn.active {
  background: linear-gradient(135deg, #7B68EE20, #4ECDC420);
  color: #7B68EE;
  border-left: 3px solid #7B68EE;
}

.tool-btn.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tool-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.tool-desc {
  font-size: 0.75rem;
  color: #666;
  margin-top: 2px;
}

.tool-btn.active .tool-desc {
  color: #888;
}

.coming-soon {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.65rem;
  padding: 2px 6px;
  background: #333;
  border-radius: 10px;
  color: #888;
}

.sidebar-footer {
  padding: 15px;
  border-top: 1px solid #333;
  text-align: center;
}

.sidebar-footer a {
  color: #666;
  font-size: 0.8rem;
  text-decoration: none;
}

.sidebar-footer a:hover {
  color: #7B68EE;
}

/* Main content */
.main-content {
  flex: 1;
  padding: 20px 30px;
  overflow-y: auto;
  max-width: 900px;
}

/* Header */
.app-header {
  margin-bottom: 25px;
}

.app-header h1 {
  font-size: 2rem;
  margin: 0;
  color: #e0e0e0;
}

.subtitle {
  color: #888;
  margin: 5px 0 0;
}

/* RNAfold content */
.rnafold-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Input section */
.input-section {
  background: #1e1e2e;
  padding: 20px;
  border-radius: 12px;
}

.input-section h2,
.params-section h2,
.results-section h2 {
  margin: 0 0 15px;
  color: #e0e0e0;
  font-size: 1.1rem;
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

/* Parameters section */
.params-section {
  background: #1e1e2e;
  padding: 20px;
  border-radius: 12px;
}

.params-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 15px;
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.param-item label {
  color: #aaa;
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
}

.param-hint {
  font-size: 0.75rem;
  color: #666;
  font-weight: normal;
}

.param-item input[type="number"],
.param-item select {
  padding: 8px 12px;
  border: 1px solid #444;
  border-radius: 6px;
  background: #0d0d1a;
  color: #e0e0e0;
  font-size: 0.9rem;
}

.param-item input[type="number"]:focus,
.param-item select:focus {
  outline: none;
  border-color: #7B68EE;
}

.param-item.checkbox {
  flex-direction: row;
  align-items: center;
}

.param-item.checkbox label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.param-item.checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #7B68EE;
}

.command-preview {
  margin-top: 15px;
  padding: 10px 15px;
  background: #0d0d1a;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.cmd-label {
  color: #666;
  font-size: 0.8rem;
}

.command-preview code {
  color: #4ECDC4;
  font-family: 'Courier New', monospace;
  font-size: 0.85rem;
}

/* Actions */
.actions {
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
}

/* Results section */
.results-section {
  background: #1e1e2e;
  padding: 20px;
  border-radius: 12px;
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

/* Tool placeholder */
.tool-placeholder {
  text-align: center;
  padding: 50px;
  color: #666;
}

.tool-placeholder h2 {
  color: #888;
}

/* Responsive */
@media (max-width: 768px) {
  .app-layout {
    flex-direction: column;
  }

  .sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #333;
  }

  .tool-nav {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .tool-btn {
    flex: 1;
    min-width: 100px;
  }

  .tool-desc {
    display: none;
  }

  .main-content {
    padding: 15px;
  }
}
</style>
