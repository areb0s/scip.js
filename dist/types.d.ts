/**
 * SCIP.js TypeScript Type Definitions
 * SCIP Optimization Solver for JavaScript/WebAssembly
 */

/**
 * Solution status
 */
export type StatusType = 'optimal' | 'infeasible' | 'unbounded' | 'timelimit' | 'unknown' | 'error';

export const Status: {
  OPTIMAL: 'optimal';
  INFEASIBLE: 'infeasible';
  UNBOUNDED: 'unbounded';
  TIME_LIMIT: 'timelimit';
  UNKNOWN: 'unknown';
  ERROR: 'error';
};

/**
 * Initialization options
 */
export interface InitOptions {
  /** Path to scip.wasm file (default: CDN) */
  wasmPath?: string;
}

/**
 * Solver options
 */
export interface SolveOptions extends InitOptions {
  /** Input format: 'lp', 'mps', 'zpl' (default: 'lp') */
  format?: 'lp' | 'mps' | 'zpl';
  /** Time limit in seconds (default: 3600) */
  timeLimit?: number;
  /** Relative gap for MIP (e.g., 0.01 for 1%) */
  gap?: number | null;
  /** Enable verbose output */
  verbose?: boolean;
  /** Additional SCIP parameters */
  parameters?: Record<string, string | number | boolean>;
}

/**
 * Solver statistics
 */
export interface Statistics {
  /** Solving time in seconds */
  solvingTime: number | null;
  /** Number of branch-and-bound nodes */
  nodes: number | null;
  /** Number of LP iterations */
  iterations: number | null;
  /** Final optimality gap (percentage) */
  gap: number | null;
}

/**
 * Solution result
 */
export interface Solution {
  /** Solution status */
  status: StatusType;
  /** Objective function value */
  objective: number | null;
  /** Variable values */
  variables: Record<string, number>;
  /** Solver statistics */
  statistics: Statistics;
  /** Exit code from SCIP */
  exitCode?: number;
  /** Raw output (if verbose mode) */
  output?: string;
  /** Raw solution file content */
  rawSolution?: string | null;
  /** Error message (if status is ERROR) */
  error?: string;
}

/**
 * Initialize SCIP WASM module
 * @param options - Initialization options
 */
export function init(options?: InitOptions): Promise<void>;

/**
 * Promise that resolves when SCIP is initialized
 * Use like OpenCV's cv.ready
 * @example
 * await SCIP.ready;
 * const result = await SCIP.solve(`...`);
 */
export const ready: Promise<void>;

/**
 * Check if SCIP is initialized
 */
export function isReady(): boolean;

/**
 * Solve an optimization problem
 * @param problem - Problem in LP, MPS, or ZIMPL format
 * @param options - Solver options
 * @returns Solution object
 * 
 * @example
 * ```typescript
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
 * if (result.status === 'optimal') {
 *   console.log('Optimal value:', result.objective);
 * }
 * ```
 */
export function solve(problem: string, options?: SolveOptions): Promise<Solution>;

/**
 * Solve a minimization problem
 */
export function minimize(problem: string, options?: SolveOptions): Promise<Solution>;

/**
 * Solve a maximization problem
 */
export function maximize(problem: string, options?: SolveOptions): Promise<Solution>;

/**
 * Get SCIP version info
 */
export function version(): Promise<string>;

/**
 * Get available SCIP parameters
 */
export function getParameters(): Promise<string>;

/**
 * SCIP module interface
 */
export interface SCIPModule {
  init: typeof init;
  ready: typeof ready;
  isReady: typeof isReady;
  solve: typeof solve;
  minimize: typeof minimize;
  maximize: typeof maximize;
  version: typeof version;
  getParameters: typeof getParameters;
  Status: typeof Status;
}

declare const SCIP: SCIPModule;
export default SCIP;

// Global declaration for CDN usage
declare global {
  interface Window {
    SCIP: SCIPModule;
    SCIP_BASE_URL?: string;
  }
  
  var SCIP: SCIPModule;
  var SCIP_BASE_URL: string | undefined;
}
