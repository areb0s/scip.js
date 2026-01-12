/**
 * SCIP.js Browser Bundle Entry Point
 * 
 * This file is the entry point for the browser IIFE bundle.
 * It exposes SCIP as a global variable for use with <script> tags.
 * 
 * Usage:
 *   <script src="https://cdn.../scip.browser.js"></script>
 *   <script>
 *     const result = await SCIP.solve(`...`);
 *   </script>
 */

import SCIP, {
  init,
  isReady,
  solve,
  minimize,
  maximize,
  version,
  getParameters,
  Status
} from './scip-wrapper.js';

// Expose to global scope
if (typeof window !== 'undefined') {
  window.SCIP = SCIP;
  window.SCIP.init = init;
  window.SCIP.isReady = isReady;
  window.SCIP.solve = solve;
  window.SCIP.minimize = minimize;
  window.SCIP.maximize = maximize;
  window.SCIP.version = version;
  window.SCIP.getParameters = getParameters;
  window.SCIP.Status = Status;
}

export default SCIP;
export {
  init,
  isReady,
  solve,
  minimize,
  maximize,
  version,
  getParameters,
  Status
};
