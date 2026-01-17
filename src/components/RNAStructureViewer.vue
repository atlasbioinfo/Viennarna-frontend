<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  sequence: string;
  structure: string;
  basePairs: Array<[number, number]>;
}>();

// Canvas dimensions
const width = 800;
const height = 600;
const padding = 50;

// Base colors
const baseColors: Record<string, string> = {
  A: '#FF6B6B',
  U: '#4ECDC4',
  G: '#45B7D1',
  C: '#96CEB4',
  N: '#CCCCCC'
};

// Calculate positions for each nucleotide using a circular layout with pair connections
const nucleotidePositions = computed(() => {
  const n = props.sequence.length;
  if (n === 0) return [];

  // Use a radial layout
  const positions: Array<{ x: number; y: number; base: string; index: number }> = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - padding - 30;

  // Simple circular layout
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    positions.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      base: props.sequence[i] ?? 'N',
      index: i + 1
    });
  }

  return positions;
});

// Calculate paths for base pair connections
const pairPaths = computed(() => {
  const paths: Array<{ d: string; i: number; j: number }> = [];

  for (const [i, j] of props.basePairs) {
    const pos1 = nucleotidePositions.value[i - 1];
    const pos2 = nucleotidePositions.value[j - 1];

    if (pos1 && pos2) {
      // Draw curved line between paired bases
      const midX = (pos1.x + pos2.x) / 2;
      const midY = (pos1.y + pos2.y) / 2;

      // Control point for curve (towards center)
      const centerX = width / 2;
      const centerY = height / 2;

      // Calculate distance to adjust curve
      const dist = Math.sqrt(
        Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2)
      );

      // Curve factor based on distance
      const curveFactor = Math.min(0.3, dist / 500);

      const ctrlX = midX + (centerX - midX) * curveFactor;
      const ctrlY = midY + (centerY - midY) * curveFactor;

      paths.push({
        d: `M ${pos1.x} ${pos1.y} Q ${ctrlX} ${ctrlY} ${pos2.x} ${pos2.y}`,
        i,
        j
      });
    }
  }

  return paths;
});

// Calculate backbone path
const backbonePath = computed(() => {
  if (nucleotidePositions.value.length < 2) return '';

  const points = nucleotidePositions.value.map(p => `${p.x},${p.y}`);
  return `M ${points.join(' L ')}`;
});
</script>

<template>
  <div ref="containerRef" class="rna-structure-viewer">
    <svg
      ref="svgRef"
      :viewBox="`0 0 ${width} ${height}`"
      class="rna-svg"
    >
      <!-- Background -->
      <rect :width="width" :height="height" fill="#1a1a2e" />

      <!-- Backbone -->
      <path
        v-if="backbonePath"
        :d="backbonePath"
        fill="none"
        stroke="#444466"
        stroke-width="2"
        stroke-linecap="round"
      />

      <!-- Base pair connections -->
      <g class="base-pairs">
        <path
          v-for="(pair, index) in pairPaths"
          :key="`pair-${index}`"
          :d="pair.d"
          fill="none"
          stroke="#7B68EE"
          stroke-width="2"
          stroke-opacity="0.6"
        />
      </g>

      <!-- Nucleotides -->
      <g class="nucleotides">
        <g
          v-for="(pos, index) in nucleotidePositions"
          :key="`nuc-${index}`"
          :transform="`translate(${pos.x}, ${pos.y})`"
        >
          <!-- Circle background -->
          <circle
            r="12"
            :fill="baseColors[pos.base] || baseColors.N"
            stroke="#ffffff"
            stroke-width="1"
          />
          <!-- Base letter -->
          <text
            text-anchor="middle"
            dominant-baseline="central"
            fill="#ffffff"
            font-size="10"
            font-weight="bold"
            font-family="monospace"
          >
            {{ pos.base }}
          </text>
        </g>
      </g>

      <!-- Position labels (every 10th) -->
      <g class="position-labels">
        <g
          v-for="(pos, index) in nucleotidePositions"
          :key="`label-${index}`"
        >
          <text
            v-if="(index + 1) % 10 === 0 || index === 0"
            :x="pos.x"
            :y="pos.y + 25"
            text-anchor="middle"
            fill="#888888"
            font-size="8"
            font-family="monospace"
          >
            {{ index + 1 }}
          </text>
        </g>
      </g>
    </svg>

    <!-- Legend -->
    <div class="legend">
      <div class="legend-item" v-for="(color, base) in baseColors" :key="base">
        <span class="color-box" :style="{ backgroundColor: color }"></span>
        <span>{{ base }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rna-structure-viewer {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
  position: relative;
}

.rna-svg {
  width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

.legend {
  display: flex;
  justify-content: center;
  gap: 20px;
  padding: 10px;
  margin-top: 10px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #e0e0e0;
  font-family: monospace;
}

.color-box {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid #ffffff;
}

.nucleotides g {
  cursor: pointer;
  transition: transform 0.2s;
}

.nucleotides g:hover {
  transform: scale(1.2);
}

.base-pairs path {
  transition: stroke-opacity 0.2s;
}

.base-pairs path:hover {
  stroke-opacity: 1;
  stroke-width: 3;
}
</style>
