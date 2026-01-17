<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';

const props = defineProps<{
  sequence: string;
  structure: string;
  basePairs: Array<[number, number]>;
}>();

const svgRef = ref<SVGSVGElement | null>(null);

// Canvas dimensions
const width = 800;
const height = 500;
const nodeRadius = 10;

// Base colors
const baseColors: Record<string, string> = {
  A: '#FF6B6B',
  U: '#4ECDC4',
  G: '#45B7D1',
  C: '#96CEB4',
  N: '#888888'
};

// Node interface
interface Node {
  id: number;
  base: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx: number | null;
  fy: number | null;
}

// Link interface
interface Link {
  source: number;
  target: number;
  type: 'backbone' | 'pair';
}

const nodes = ref<Node[]>([]);
const links = ref<Link[]>([]);
const isSimulating = ref(false);
const transform = ref({ x: 0, y: 0, scale: 1 });

// Initialize nodes and links
function initializeGraph() {
  const n = props.sequence.length;
  if (n === 0) return;

  // Create nodes with initial circular layout
  const newNodes: Node[] = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 3;

  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    newNodes.push({
      id: i,
      base: props.sequence[i] ?? 'N',
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      fx: null,
      fy: null
    });
  }

  // Create links
  const newLinks: Link[] = [];

  // Backbone links (sequential connections)
  for (let i = 0; i < n - 1; i++) {
    newLinks.push({
      source: i,
      target: i + 1,
      type: 'backbone'
    });
  }

  // Base pair links
  for (const [i, j] of props.basePairs) {
    newLinks.push({
      source: i - 1, // Convert to 0-indexed
      target: j - 1,
      type: 'pair'
    });
  }

  nodes.value = newNodes;
  links.value = newLinks;
}

// Force simulation parameters
const forceParams = {
  repulsion: 800,
  backboneLength: 25,
  pairLength: 40,
  damping: 0.9,
  minDistance: 20
};

// Run force simulation
function simulate() {
  if (!isSimulating.value) return;

  const nodeList = nodes.value;
  const linkList = links.value;
  const n = nodeList.length;

  // Apply forces
  for (let i = 0; i < n; i++) {
    const node = nodeList[i];
    if (!node || node.fx !== null) continue;

    let fx = 0;
    let fy = 0;

    // Repulsion between all nodes
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const other = nodeList[j];
      if (!other) continue;

      const dx = node.x - other.x;
      const dy = node.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      if (dist < forceParams.minDistance * 5) {
        const force = forceParams.repulsion / (dist * dist);
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
    }

    // Link forces
    for (const link of linkList) {
      let otherIdx: number | null = null;
      if (link.source === i) otherIdx = link.target;
      else if (link.target === i) otherIdx = link.source;

      if (otherIdx !== null) {
        const other = nodeList[otherIdx];
        if (!other) continue;

        const dx = other.x - node.x;
        const dy = other.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLength = link.type === 'backbone' ? forceParams.backboneLength : forceParams.pairLength;
        const force = (dist - targetLength) * 0.1;

        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
    }

    // Center gravity
    fx += (width / 2 - node.x) * 0.001;
    fy += (height / 2 - node.y) * 0.001;

    // Update velocity with damping
    node.vx = (node.vx + fx) * forceParams.damping;
    node.vy = (node.vy + fy) * forceParams.damping;
  }

  // Update positions
  for (const node of nodeList) {
    if (!node || node.fx !== null) continue;
    node.x += node.vx;
    node.y += node.vy;

    // Boundary constraints
    node.x = Math.max(nodeRadius, Math.min(width - nodeRadius, node.x));
    node.y = Math.max(nodeRadius, Math.min(height - nodeRadius, node.y));
  }

  // Trigger reactivity
  nodes.value = [...nodeList];

  // Continue simulation
  requestAnimationFrame(simulate);
}

// Start simulation
function startSimulation() {
  isSimulating.value = true;
  simulate();
}

// Stop simulation
function stopSimulation() {
  isSimulating.value = false;
}

// Reset layout
function resetLayout() {
  initializeGraph();
  startSimulation();
  setTimeout(stopSimulation, 3000); // Run for 3 seconds
}

// Dragging
const draggedNode = ref<number | null>(null);

function onMouseDown(_event: MouseEvent, nodeId: number) {
  draggedNode.value = nodeId;
  const node = nodes.value[nodeId];
  if (node) {
    node.fx = node.x;
    node.fy = node.y;
  }
}

function onMouseMove(event: MouseEvent) {
  if (draggedNode.value === null) return;

  const svg = svgRef.value;
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  const x = (event.clientX - rect.left - transform.value.x) / transform.value.scale;
  const y = (event.clientY - rect.top - transform.value.y) / transform.value.scale;

  const node = nodes.value[draggedNode.value];
  if (node) {
    node.x = x;
    node.y = y;
    node.fx = x;
    node.fy = y;
    nodes.value = [...nodes.value];
  }
}

function onMouseUp() {
  if (draggedNode.value !== null) {
    const node = nodes.value[draggedNode.value];
    if (node) {
      node.fx = null;
      node.fy = null;
    }
  }
  draggedNode.value = null;
}

// Zoom
function onWheel(event: WheelEvent) {
  event.preventDefault();
  const delta = event.deltaY > 0 ? 0.9 : 1.1;
  transform.value.scale = Math.max(0.5, Math.min(3, transform.value.scale * delta));
}

// Computed path for links
const linkPaths = computed(() => {
  return links.value.map(link => {
    const source = nodes.value[link.source];
    const target = nodes.value[link.target];
    if (!source || !target) return { d: '', type: link.type };

    if (link.type === 'pair') {
      // Curved line for base pairs
      const mx = (source.x + target.x) / 2;
      const my = (source.y + target.y) / 2;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      // Control point perpendicular to the line
      const cx = mx - dy * 0.2;
      const cy = my + dx * 0.2;
      return {
        d: `M ${source.x} ${source.y} Q ${cx} ${cy} ${target.x} ${target.y}`,
        type: link.type
      };
    } else {
      // Straight line for backbone
      return {
        d: `M ${source.x} ${source.y} L ${target.x} ${target.y}`,
        type: link.type
      };
    }
  });
});

// Initialize on mount
onMounted(() => {
  initializeGraph();
  startSimulation();
  setTimeout(stopSimulation, 2000);
});

// Watch for changes
watch(() => [props.sequence, props.structure, props.basePairs], () => {
  resetLayout();
}, { deep: true });
</script>

<template>
  <div ref="containerRef" class="force-graph-viewer">
    <div class="controls">
      <button @click="resetLayout" class="control-btn">
        Reset Layout
      </button>
      <button @click="isSimulating ? stopSimulation() : startSimulation()" class="control-btn">
        {{ isSimulating ? 'Stop' : 'Start' }} Simulation
      </button>
      <span class="hint">Drag nodes to adjust layout. Scroll to zoom.</span>
    </div>

    <svg
      ref="svgRef"
      :viewBox="`0 0 ${width} ${height}`"
      class="force-svg"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
      @wheel="onWheel"
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="10"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7" fill="#666" />
        </marker>
      </defs>

      <g :transform="`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`">
        <!-- Background -->
        <rect :width="width" :height="height" fill="#0d0d1a" rx="8" />

        <!-- Links -->
        <g class="links">
          <path
            v-for="(link, idx) in linkPaths"
            :key="`link-${idx}`"
            :d="link.d"
            fill="none"
            :stroke="link.type === 'pair' ? '#7B68EE' : '#444466'"
            :stroke-width="link.type === 'pair' ? 2 : 1.5"
            :stroke-opacity="link.type === 'pair' ? 0.8 : 0.6"
            :stroke-dasharray="link.type === 'pair' ? 'none' : 'none'"
          />
        </g>

        <!-- Nodes -->
        <g class="nodes">
          <g
            v-for="node in nodes"
            :key="`node-${node.id}`"
            :transform="`translate(${node.x}, ${node.y})`"
            class="node"
            @mousedown="(e) => onMouseDown(e, node.id)"
          >
            <circle
              :r="nodeRadius"
              :fill="baseColors[node.base] || baseColors.N"
              stroke="#fff"
              stroke-width="1.5"
            />
            <text
              text-anchor="middle"
              dominant-baseline="central"
              fill="#fff"
              font-size="9"
              font-weight="bold"
              font-family="monospace"
              pointer-events="none"
            >
              {{ node.base }}
            </text>
          </g>
        </g>

        <!-- Position labels (every 10th) -->
        <g class="labels">
          <text
            v-for="node in nodes.filter((_, i) => (i + 1) % 10 === 0 || i === 0)"
            :key="`label-${node.id}`"
            :x="node.x"
            :y="node.y + nodeRadius + 12"
            text-anchor="middle"
            fill="#666"
            font-size="8"
            font-family="monospace"
            pointer-events="none"
          >
            {{ node.id + 1 }}
          </text>
        </g>
      </g>
    </svg>

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
        <span class="legend-title">Links:</span>
        <div class="legend-item">
          <span class="line-sample backbone"></span>
          <span>Backbone</span>
        </div>
        <div class="legend-item">
          <span class="line-sample pair"></span>
          <span>Base pair</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.force-graph-viewer {
  width: 100%;
  max-width: 850px;
  margin: 0 auto;
}

.controls {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.control-btn {
  padding: 6px 12px;
  background: #2a2a3e;
  border: 1px solid #444;
  border-radius: 4px;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.control-btn:hover {
  background: #3a3a4e;
  border-color: #7B68EE;
}

.hint {
  color: #666;
  font-size: 0.8rem;
  margin-left: auto;
}

.force-svg {
  width: 100%;
  height: auto;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  cursor: grab;
}

.force-svg:active {
  cursor: grabbing;
}

.node {
  cursor: pointer;
  transition: transform 0.1s;
}

.node:hover circle {
  stroke-width: 3;
  filter: brightness(1.2);
}

.legend {
  display: flex;
  justify-content: center;
  gap: 30px;
  padding: 15px;
  margin-top: 10px;
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
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid #fff;
}

.line-sample {
  width: 20px;
  height: 3px;
  border-radius: 2px;
}

.line-sample.backbone {
  background: #444466;
}

.line-sample.pair {
  background: #7B68EE;
}
</style>
