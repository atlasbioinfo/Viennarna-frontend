<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  sequence: string;
  structure: string;
  basePairs: Array<[number, number]>;
}>();

// Base colors
const baseColors: Record<string, string> = {
  A: '#FF6B6B',
  U: '#4ECDC4',
  G: '#45B7D1',
  C: '#96CEB4',
  N: '#888888'
};

// Dimensions
const nodeSpacing = 14;
const nodeRadius = 6;
const padding = { left: 40, right: 40, top: 30, bottom: 60 };
const arcAreaHeight = 200;

// Hover state
const hoveredPair = ref<[number, number] | null>(null);
const hoveredBase = ref<number | null>(null);

// Calculate SVG dimensions
const svgWidth = computed(() => {
  return padding.left + props.sequence.length * nodeSpacing + padding.right;
});

const svgHeight = computed(() => {
  return padding.top + arcAreaHeight + padding.bottom;
});

// Calculate node positions (linear layout)
const nodes = computed(() => {
  return Array.from(props.sequence).map((base, i) => ({
    id: i,
    base: base ?? 'N',
    x: padding.left + i * nodeSpacing,
    y: padding.top + arcAreaHeight
  }));
});

// Calculate arc paths for base pairs
const arcs = computed(() => {
  return props.basePairs.map(([i, j]) => {
    const x1 = padding.left + (i - 1) * nodeSpacing;
    const x2 = padding.left + (j - 1) * nodeSpacing;
    const radius = (x2 - x1) / 2;
    // Height proportional to distance
    const arcHeight = Math.min(radius * 0.8, arcAreaHeight - 20);

    // Get base pair type for coloring
    const base1 = props.sequence[i - 1] ?? 'N';
    const base2 = props.sequence[j - 1] ?? 'N';
    const pairType = getPairType(base1, base2);

    return {
      i,
      j,
      path: `M ${x1} ${padding.top + arcAreaHeight}
             A ${radius} ${arcHeight} 0 0 1 ${x2} ${padding.top + arcAreaHeight}`,
      color: getPairColor(pairType),
      pairType,
      base1,
      base2
    };
  });
});

// Get pair type
function getPairType(b1: string, b2: string): string {
  const pair = `${b1}${b2}`;
  if (pair === 'GC' || pair === 'CG') return 'GC';
  if (pair === 'AU' || pair === 'UA') return 'AU';
  if (pair === 'GU' || pair === 'UG') return 'GU';
  return 'other';
}

// Get color based on pair type
function getPairColor(pairType: string): string {
  switch (pairType) {
    case 'GC': return '#7B68EE'; // Purple for GC
    case 'AU': return '#FFD93D'; // Yellow for AU
    case 'GU': return '#FF8C42'; // Orange for GU wobble
    default: return '#888888';
  }
}

// Check if a base is part of the hovered pair
function isHighlighted(idx: number): boolean {
  if (hoveredPair.value) {
    return idx + 1 === hoveredPair.value[0] || idx + 1 === hoveredPair.value[1];
  }
  return false;
}
</script>

<template>
  <div class="arc-diagram-viewer">
    <div class="scroll-container">
      <svg
        :width="svgWidth"
        :height="svgHeight"
        :viewBox="`0 0 ${svgWidth} ${svgHeight}`"
        class="arc-svg"
      >
        <!-- Background -->
        <rect :width="svgWidth" :height="svgHeight" fill="#0d0d1a" rx="8" />

        <!-- Arcs (base pairs) -->
        <g class="arcs">
          <path
            v-for="(arc, idx) in arcs"
            :key="`arc-${idx}`"
            :d="arc.path"
            fill="none"
            :stroke="arc.color"
            :stroke-width="hoveredPair && hoveredPair[0] === arc.i && hoveredPair[1] === arc.j ? 3 : 2"
            :stroke-opacity="hoveredPair ? (hoveredPair[0] === arc.i && hoveredPair[1] === arc.j ? 1 : 0.3) : 0.7"
            class="arc-path"
            @mouseenter="hoveredPair = [arc.i, arc.j]"
            @mouseleave="hoveredPair = null"
          />
        </g>

        <!-- Backbone line -->
        <line
          :x1="padding.left"
          :y1="padding.top + arcAreaHeight"
          :x2="padding.left + (sequence.length - 1) * nodeSpacing"
          :y2="padding.top + arcAreaHeight"
          stroke="#333"
          stroke-width="2"
        />

        <!-- Nodes (bases) -->
        <g class="nodes">
          <g
            v-for="(node, idx) in nodes"
            :key="`node-${idx}`"
            :transform="`translate(${node.x}, ${node.y})`"
            class="node"
            @mouseenter="hoveredBase = idx"
            @mouseleave="hoveredBase = null"
          >
            <circle
              :r="isHighlighted(idx) || hoveredBase === idx ? nodeRadius * 1.3 : nodeRadius"
              :fill="baseColors[node.base] || baseColors.N"
              :stroke="isHighlighted(idx) ? '#fff' : 'transparent'"
              :stroke-width="isHighlighted(idx) ? 2 : 0"
              class="node-circle"
            />
            <text
              v-if="sequence.length <= 100"
              y="20"
              text-anchor="middle"
              :fill="structure[idx] === '.' ? '#555' : '#888'"
              font-size="8"
              font-family="monospace"
            >
              {{ node.base }}
            </text>
          </g>
        </g>

        <!-- Position markers -->
        <g class="position-markers">
          <g
            v-for="i in Math.floor(sequence.length / 10)"
            :key="`marker-${i}`"
          >
            <line
              :x1="padding.left + (i * 10 - 1) * nodeSpacing"
              :y1="padding.top + arcAreaHeight + 8"
              :x2="padding.left + (i * 10 - 1) * nodeSpacing"
              :y2="padding.top + arcAreaHeight + 12"
              stroke="#666"
              stroke-width="1"
            />
            <text
              :x="padding.left + (i * 10 - 1) * nodeSpacing"
              :y="padding.top + arcAreaHeight + 24"
              text-anchor="middle"
              fill="#666"
              font-size="9"
              font-family="monospace"
            >
              {{ i * 10 }}
            </text>
          </g>
        </g>

        <!-- Hover info -->
        <g v-if="hoveredPair" class="hover-info">
          <rect
            x="10"
            y="10"
            width="140"
            height="50"
            fill="#1e1e2e"
            stroke="#444"
            rx="4"
          />
          <text x="20" y="30" fill="#e0e0e0" font-size="11">
            Base pair: {{ hoveredPair[0] }}-{{ hoveredPair[1] }}
          </text>
          <text x="20" y="48" fill="#888" font-size="10">
            {{ sequence[hoveredPair[0] - 1] }}-{{ sequence[hoveredPair[1] - 1] }}
            ({{ arcs.find(a => a.i === hoveredPair![0])?.pairType }})
          </text>
        </g>
      </svg>
    </div>

    <!-- Legend -->
    <div class="legend">
      <div class="legend-section">
        <span class="legend-title">Bases:</span>
        <div class="legend-item" v-for="(color, base) in baseColors" :key="base">
          <span class="color-box" :style="{ backgroundColor: color }"></span>
          <span>{{ base }}</span>
        </div>
      </div>
      <div class="legend-section">
        <span class="legend-title">Pair types:</span>
        <div class="legend-item">
          <span class="line-sample" style="background: #7B68EE"></span>
          <span>G-C</span>
        </div>
        <div class="legend-item">
          <span class="line-sample" style="background: #FFD93D"></span>
          <span>A-U</span>
        </div>
        <div class="legend-item">
          <span class="line-sample" style="background: #FF8C42"></span>
          <span>G-U</span>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="stats">
      <span>Length: {{ sequence.length }} nt</span>
      <span>Base pairs: {{ basePairs.length }}</span>
      <span>G-C: {{ arcs.filter(a => a.pairType === 'GC').length }}</span>
      <span>A-U: {{ arcs.filter(a => a.pairType === 'AU').length }}</span>
      <span>G-U: {{ arcs.filter(a => a.pairType === 'GU').length }}</span>
    </div>
  </div>
</template>

<style scoped>
.arc-diagram-viewer {
  width: 100%;
}

.scroll-container {
  overflow-x: auto;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

.arc-svg {
  display: block;
  min-width: 100%;
}

.arc-path {
  cursor: pointer;
  transition: stroke-width 0.2s, stroke-opacity 0.2s;
}

.arc-path:hover {
  stroke-width: 3;
}

.node {
  cursor: pointer;
}

.node-circle {
  transition: r 0.2s, stroke 0.2s;
}

.legend {
  display: flex;
  justify-content: center;
  gap: 30px;
  padding: 15px;
  flex-wrap: wrap;
}

.legend-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.legend-title {
  color: #888;
  font-size: 0.85rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #e0e0e0;
  font-family: monospace;
  font-size: 0.85rem;
}

.color-box {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid #fff;
}

.line-sample {
  width: 20px;
  height: 3px;
  border-radius: 2px;
}

.stats {
  display: flex;
  justify-content: center;
  gap: 20px;
  padding: 10px;
  color: #666;
  font-size: 0.85rem;
  flex-wrap: wrap;
}

.stats span {
  padding: 4px 10px;
  background: #1e1e2e;
  border-radius: 4px;
}
</style>
