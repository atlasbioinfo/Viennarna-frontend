<script setup lang="ts">
import { ref } from 'vue';
import RNAfoldApp from './components/RNAfoldApp.vue';
import RNAevalApp from './components/RNAevalApp.vue';
import RNAsuboptApp from './components/RNAsuboptApp.vue';
import RNAcofoldApp from './components/RNAcofoldApp.vue';
import RNAduplexApp from './components/RNAduplexApp.vue';
import RNAinverseApp from './components/RNAinverseApp.vue';

// Current module
type ModuleId = 'fold' | 'eval' | 'subopt' | 'cofold' | 'duplex' | 'inverse';
const currentModule = ref<ModuleId>('fold');

// Module definitions
const modules = [
  {
    id: 'fold' as ModuleId,
    name: 'RNAfold',
    description: 'MFE structure prediction',
    color: '#7B68EE'
  },
  {
    id: 'eval' as ModuleId,
    name: 'RNAeval',
    description: 'Energy evaluation',
    color: '#4ECDC4'
  },
  {
    id: 'subopt' as ModuleId,
    name: 'RNAsubopt',
    description: 'Suboptimal structures',
    color: '#FFD93D'
  },
  {
    id: 'cofold' as ModuleId,
    name: 'RNAcofold',
    description: 'RNA cofolding',
    color: '#45B7D1'
  },
  {
    id: 'duplex' as ModuleId,
    name: 'RNAduplex',
    description: 'RNA interaction',
    color: '#E040FB'
  },
  {
    id: 'inverse' as ModuleId,
    name: 'RNAinverse',
    description: 'Sequence design',
    color: '#00BFA5'
  }
];

// Mobile menu state
const menuOpen = ref(false);

function selectModule(id: ModuleId) {
  currentModule.value = id;
  menuOpen.value = false;
}
</script>

<template>
  <div class="vienna-app">
    <!-- Navigation Header -->
    <nav class="main-nav">
      <div class="nav-brand">
        <span class="brand-icon">RNA</span>
        <span class="brand-text">ViennaRNA Web</span>
      </div>

      <!-- Mobile menu toggle -->
      <button class="menu-toggle" @click="menuOpen = !menuOpen" aria-label="Toggle menu">
        <span class="menu-icon" :class="{ open: menuOpen }"></span>
      </button>

      <!-- Module tabs -->
      <div class="nav-modules" :class="{ open: menuOpen }">
        <button
          v-for="mod in modules"
          :key="mod.id"
          :class="['module-tab', { active: currentModule === mod.id }]"
          :style="currentModule === mod.id ? { borderColor: mod.color, color: mod.color } : {}"
          @click="selectModule(mod.id)"
        >
          <span class="module-name">{{ mod.name }}</span>
          <span class="module-desc">{{ mod.description }}</span>
        </button>
      </div>
    </nav>

    <!-- Module Content -->
    <div class="module-content">
      <RNAfoldApp v-if="currentModule === 'fold'" />
      <RNAevalApp v-else-if="currentModule === 'eval'" />
      <RNAsuboptApp v-else-if="currentModule === 'subopt'" />
      <RNAcofoldApp v-else-if="currentModule === 'cofold'" />
      <RNAduplexApp v-else-if="currentModule === 'duplex'" />
      <RNAinverseApp v-else-if="currentModule === 'inverse'" />
    </div>
  </div>
</template>

<style>
/* Global styles */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  background: #0d0d1a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
</style>

<style scoped>
.vienna-app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Navigation */
.main-nav {
  background: #1a1a2e;
  border-bottom: 1px solid #333;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 20px;
  position: sticky;
  top: 0;
  z-index: 100;
  flex-wrap: wrap;
}

.nav-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 15px 0;
}

.brand-icon {
  background: linear-gradient(135deg, #7B68EE, #4ECDC4);
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  font-weight: bold;
  font-size: 0.85rem;
}

.brand-text {
  font-size: 1.1rem;
  font-weight: 600;
  color: #e0e0e0;
}

.menu-toggle {
  display: none;
  background: none;
  border: none;
  padding: 10px;
  cursor: pointer;
  margin-left: auto;
}

.menu-icon {
  display: block;
  width: 24px;
  height: 2px;
  background: #e0e0e0;
  position: relative;
  transition: background 0.2s;
}

.menu-icon::before,
.menu-icon::after {
  content: '';
  position: absolute;
  width: 24px;
  height: 2px;
  background: #e0e0e0;
  left: 0;
  transition: transform 0.2s;
}

.menu-icon::before {
  top: -7px;
}

.menu-icon::after {
  top: 7px;
}

.menu-icon.open {
  background: transparent;
}

.menu-icon.open::before {
  transform: rotate(45deg) translate(5px, 5px);
}

.menu-icon.open::after {
  transform: rotate(-45deg) translate(5px, -5px);
}

.nav-modules {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  padding: 10px 0;
}

.module-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 16px;
  border: 2px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #888;
  cursor: pointer;
  transition: all 0.2s;
}

.module-tab:hover:not(.active) {
  background: #ffffff10;
  color: #aaa;
}

.module-tab.active {
  background: #ffffff08;
}

.module-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.module-desc {
  font-size: 0.7rem;
  opacity: 0.7;
}

/* Module content */
.module-content {
  flex: 1;
  padding-bottom: 40px;
}

/* Mobile responsive */
@media (max-width: 900px) {
  .menu-toggle {
    display: block;
  }

  .nav-modules {
    display: none;
    width: 100%;
    padding: 15px 0;
    flex-direction: column;
    gap: 8px;
  }

  .nav-modules.open {
    display: flex;
  }

  .module-tab {
    width: 100%;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
  }

  .module-desc {
    text-align: right;
  }
}

@media (max-width: 600px) {
  .brand-text {
    display: none;
  }
}
</style>
