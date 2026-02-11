/**
 * SCIP.js - SCIP Optimization Solver for JavaScript/WebAssembly
 * 
 * Supports: LP, MIP, MINLP (Mixed Integer Nonlinear Programming)
 * 
 * @example
 * // Basic usage
 * import SCIP from 'scip.js';
 * 
 * const result = await SCIP.solve(`
 *   Minimize obj: x + 2 y
 *   Subject To
 *     c1: x + y >= 1
 *   Bounds
 *     0 <= x <= 10
 *     0 <= y <= 10
 *   End
 * `);
 * 
 * console.log(result.status);     // 'optimal'
 * console.log(result.objective);  // 1.0
 * console.log(result.variables);  // { x: 1, y: 0 }
 * 
 * @example
 * // With Web Worker (non-blocking)
 * import { createWorkerSolver } from 'scip.js';
 * 
 * const solver = await createWorkerSolver();
 * const result = await solver.solve(problem);
 * solver.terminate();
 */

// Main thread API
export { 
  init, 
  isReady, 
  solve, 
  minimize, 
  maximize, 
  version,
  getParameters,
  Status 
} from './scip-wrapper.js';

// Worker API
export { 
  init as initWorker,
  solve as solveInWorker,
  minimize as minimizeInWorker,
  maximize as maximizeInWorker,
  terminate as terminateWorker
} from './scip-worker-client.js';

// Callback API (with incumbent/node callbacks support)
export { 
  SCIPApi,
  solveWithCallbacks,
  Status as ApiStatus
} from './scip-api-wrapper.js';

// Default export (main thread API)
import SCIP from './scip-wrapper.js';
export default SCIP;

/**
 * Create a worker-based solver instance
 * Use this for long-running optimizations to avoid blocking the main thread
 */
export async function createWorkerSolver(options = {}) {
  const worker = await import('./scip-worker-client.js');
  await worker.init(options);
  return {
    solve: worker.solve,
    minimize: worker.minimize,
    maximize: worker.maximize,
    version: worker.version,
    isReady: worker.isReady,
    terminate: worker.terminate
  };
}

/**
 * Create a callback-enabled solver instance
 * Use this when you need incumbent callbacks for custom pruning logic
 * 
 * @example
 * const solver = await createCallbackSolver();
 * solver.onIncumbent((objValue) => {
 *   console.log('New best solution:', objValue);
 * });
 * const result = await solver.solve(problem, {
 *   format: 'zpl',
 *   initialSolution: { x: 1, y: 0 },
 *   cutoff: 100
 * });
 * solver.destroy();
 */
export async function createCallbackSolver(options = {}) {
  const { SCIPApi } = await import('./scip-api-wrapper.js');
  const solver = new SCIPApi();
  await solver.init(options);
  return solver;
}
