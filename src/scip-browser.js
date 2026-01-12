/**
 * SCIP.js Browser Bundle Entry Point
 * 
 * This file is the entry point for the browser IIFE bundle.
 * It exposes SCIP as a global variable for use with <script> tags or Workers.
 * 
 * Usage (Browser):
 *   <script src="https://cdn.../scip.min.js"></script>
 *   <script>
 *     await SCIP.ready;
 *     const result = await SCIP.solve(`...`);
 *   </script>
 * 
 * Usage (Worker):
 *   // Set base URL before loading
 *   self.SCIP_BASE_URL = 'https://cdn.../dist/';
 *   
 *   // Fetch and execute
 *   const response = await fetch(self.SCIP_BASE_URL + 'scip.min.js');
 *   new Function(await response.text())();
 *   
 *   // Wait for ready
 *   await self.SCIP.ready;
 *   
 *   // Use
 *   const result = await self.SCIP.solve(`...`);
 */

import SCIP, {
  init,
  ready,
  isReady,
  solve,
  minimize,
  maximize,
  version,
  getParameters,
  Status
} from './scip-wrapper.js';

// Get global scope (works in browser, worker, node)
const globalScope = typeof globalThis !== 'undefined' ? globalThis :
                    typeof self !== 'undefined' ? self :
                    typeof window !== 'undefined' ? window : {};

// Expose to global scope
globalScope.SCIP = SCIP;
globalScope.SCIP.init = init;
globalScope.SCIP.ready = ready;
globalScope.SCIP.isReady = isReady;
globalScope.SCIP.solve = solve;
globalScope.SCIP.minimize = minimize;
globalScope.SCIP.maximize = maximize;
globalScope.SCIP.version = version;
globalScope.SCIP.getParameters = getParameters;
globalScope.SCIP.Status = Status;

// Auto-initialize when script loads (like OpenCV)
// This starts loading WASM in background
init().catch((err) => {
  console.error('[SCIP.js] Auto-initialization failed:', err.message);
  console.error('[SCIP.js] Set SCIP_BASE_URL before loading, or call SCIP.init({ wasmPath: "..." })');
});

export default SCIP;
export {
  init,
  ready,
  isReady,
  solve,
  minimize,
  maximize,
  version,
  getParameters,
  Status
};
