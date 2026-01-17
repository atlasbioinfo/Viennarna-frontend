/**
 * TypeScript wrapper for RNAfold WebAssembly module
 */

// Define the module interface
interface RNAfoldWasmModule {
  ccall: (
    name: string,
    returnType: string,
    argTypes: string[],
    args: unknown[]
  ) => unknown;
  cwrap: (
    name: string,
    returnType: string,
    argTypes: string[]
  ) => (...args: unknown[]) => unknown;
  UTF8ToString: (ptr: number) => string;
  stringToUTF8: (str: string, ptr: number, maxLength: number) => void;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
}

export interface WasmFoldResult {
  sequence: string;
  structure: string;
  mfe: number;
  basePairs: Array<[number, number]>;
  computeTime: number;
}

// Module loading state
let wasmModule: RNAfoldWasmModule | null = null;
let moduleLoading: Promise<RNAfoldWasmModule> | null = null;

/**
 * Load the WebAssembly module
 */
export async function loadWasmModule(): Promise<RNAfoldWasmModule> {
  if (wasmModule) {
    return wasmModule;
  }

  if (moduleLoading) {
    return moduleLoading;
  }

  moduleLoading = (async () => {
    // Load the Emscripten-generated JS file from public folder
    const baseUrl = import.meta.env.BASE_URL || '/';
    const jsUrl = `${baseUrl}wasm/rnafold.js`;

    // Load the module factory script
    const script = document.createElement('script');
    script.src = jsUrl;

    await new Promise<void>((resolve, reject) => {
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load WASM module script'));
      document.head.appendChild(script);
    });

    // The script creates a global createRNAfoldModule function
    const createModule = (window as unknown as { createRNAfoldModule: () => Promise<RNAfoldWasmModule> }).createRNAfoldModule;
    if (!createModule) {
      throw new Error('createRNAfoldModule not found');
    }

    const module = await createModule();
    wasmModule = module;
    return wasmModule;
  })();

  return moduleLoading;
}

/**
 * Check if the WASM module is loaded
 */
export function isWasmLoaded(): boolean {
  return wasmModule !== null;
}

/**
 * Parse dot-bracket structure to get base pairs
 */
function parseBasePairs(structure: string): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const stack: number[] = [];

  for (let i = 0; i < structure.length; i++) {
    const char = structure[i];
    if (char === '(') {
      stack.push(i + 1); // 1-indexed
    } else if (char === ')') {
      const j = stack.pop();
      if (j !== undefined) {
        pairs.push([j, i + 1]); // 1-indexed
      }
    }
  }

  // Sort by first position
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs;
}

/**
 * Fold an RNA sequence using WebAssembly
 */
export async function foldWasm(sequence: string): Promise<WasmFoldResult> {
  const module = await loadWasmModule();

  // Clean sequence
  const cleanedSequence = sequence
    .toUpperCase()
    .replace(/T/g, 'U')
    .replace(/[^ACGU]/g, '');

  if (cleanedSequence.length === 0) {
    throw new Error('Invalid sequence: no valid nucleotides found');
  }

  const startTime = performance.now();

  // Allocate memory for the sequence string
  const seqLen = cleanedSequence.length + 1;
  const seqPtr = module._malloc(seqLen);

  try {
    // Copy sequence to WASM memory
    module.stringToUTF8(cleanedSequence, seqPtr, seqLen);

    // Call fold function
    const result = module.ccall(
      'fold_sequence',
      'number',
      ['number'],
      [seqPtr]
    ) as number;

    if (result !== 0) {
      throw new Error('Folding failed');
    }

    // Get results
    const mfe = module.ccall('get_mfe', 'number', [], []) as number;
    const structurePtr = module.ccall('get_structure', 'number', [], []) as number;
    const structure = module.UTF8ToString(structurePtr);

    const endTime = performance.now();

    return {
      sequence: cleanedSequence,
      structure,
      mfe,
      basePairs: parseBasePairs(structure),
      computeTime: endTime - startTime
    };
  } finally {
    // Free allocated memory
    module._free(seqPtr);
  }
}

/**
 * Preload the WASM module (call this early for better UX)
 */
export function preloadWasm(): void {
  loadWasmModule().catch(console.error);
}
