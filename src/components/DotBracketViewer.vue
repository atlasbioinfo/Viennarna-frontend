<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  sequence: string;
  structure: string;
}>();

// Base colors
const baseColors: Record<string, string> = {
  A: '#FF6B6B',
  U: '#4ECDC4',
  G: '#45B7D1',
  C: '#96CEB4',
  N: '#CCCCCC'
};

// Structure symbol colors
const structureColors: Record<string, string> = {
  '(': '#7B68EE',
  ')': '#7B68EE',
  '.': '#555555'
};

// Create array of sequence/structure pairs with position
const pairs = computed(() => {
  const result: Array<{ base: string; bracket: string; position: number }> = [];
  const len = Math.min(props.sequence.length, props.structure.length);

  for (let i = 0; i < len; i++) {
    result.push({
      base: props.sequence[i] ?? 'N',
      bracket: props.structure[i] ?? '.',
      position: i + 1
    });
  }
  return result;
});

// Split into chunks for display
const chunkSize = 60;
const chunks = computed(() => {
  const result = [];
  for (let i = 0; i < pairs.value.length; i += chunkSize) {
    result.push(pairs.value.slice(i, i + chunkSize));
  }
  return result;
});
</script>

<template>
  <div class="dot-bracket-viewer">
    <div
      v-for="(chunk, chunkIndex) in chunks"
      :key="chunkIndex"
      class="sequence-chunk"
    >
      <!-- Position markers -->
      <div class="position-row">
        <span class="position-label">{{ chunkIndex * chunkSize + 1 }}</span>
        <span
          v-for="(item, i) in chunk"
          :key="`pos-${i}`"
          class="position-marker"
          :class="{ 'show-marker': item.position % 10 === 0 }"
        >
          {{ item.position % 10 === 0 ? '|' : '' }}
        </span>
      </div>

      <!-- Sequence row -->
      <div class="sequence-row">
        <span class="row-label">Seq:</span>
        <span
          v-for="(item, i) in chunk"
          :key="`seq-${i}`"
          class="base"
          :style="{ color: baseColors[item.base] || baseColors.N }"
          :title="`Position ${item.position}: ${item.base}`"
        >
          {{ item.base }}
        </span>
      </div>

      <!-- Structure row -->
      <div class="structure-row">
        <span class="row-label">Str:</span>
        <span
          v-for="(item, i) in chunk"
          :key="`str-${i}`"
          class="bracket"
          :style="{ color: structureColors[item.bracket] || '#555' }"
          :title="`Position ${item.position}: ${item.bracket === '.' ? 'unpaired' : 'paired'}`"
        >
          {{ item.bracket }}
        </span>
      </div>

      <!-- Position numbers -->
      <div class="position-numbers">
        <span class="row-label"></span>
        <span
          v-for="(item, i) in chunk"
          :key="`num-${i}`"
          class="position-number"
        >
          {{ item.position % 10 === 0 ? item.position : '' }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dot-bracket-viewer {
  font-family: 'Courier New', Courier, monospace;
  font-size: 14px;
  background: #1a1a2e;
  padding: 20px;
  border-radius: 8px;
  overflow-x: auto;
}

.sequence-chunk {
  margin-bottom: 25px;
}

.position-row,
.sequence-row,
.structure-row,
.position-numbers {
  display: flex;
  align-items: center;
  white-space: nowrap;
}

.row-label {
  width: 40px;
  color: #888;
  flex-shrink: 0;
}

.position-label {
  width: 40px;
  color: #666;
  font-size: 10px;
  flex-shrink: 0;
}

.position-marker {
  width: 0.6em;
  text-align: center;
  color: #666;
  font-size: 10px;
}

.show-marker {
  color: #888;
}

.base,
.bracket,
.position-number {
  width: 0.6em;
  text-align: center;
  transition: transform 0.1s, font-size 0.1s;
}

.base:hover,
.bracket:hover {
  transform: scale(1.3);
  font-weight: bold;
}

.position-number {
  font-size: 8px;
  color: #666;
  width: 0.6em;
}

.sequence-row {
  margin: 3px 0;
}

.structure-row {
  margin: 3px 0;
}
</style>
