/**
 * SCIP.js TypeScript Type Definitions
 * SCIP Optimization Solver for JavaScript/WebAssembly
 */

declare module 'scip.js' {
  /**
   * Solution status
   */
  export enum Status {
    OPTIMAL = 'optimal',
    INFEASIBLE = 'infeasible',
    UNBOUNDED = 'unbounded',
    TIME_LIMIT = 'timelimit',
    UNKNOWN = 'unknown',
    ERROR = 'error'
  }

  /**
   * Initialization options
   */
  export interface InitOptions {
    /** Path to scip.wasm file (default: './scip.wasm') */
    wasmPath?: string;
    /** Path to Web Worker script (for worker mode) */
    workerPath?: string;
  }

  /**
   * Solver options
   */
  export interface SolveOptions {
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
    /** Init options (for worker mode) */
    initOptions?: InitOptions;
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
    status: Status;
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
   * const result = await solve(`
   *   Minimize obj: x + 2 y
   *   Subject To
   *     c1: x + y >= 1
   *   Bounds
   *     0 <= x <= 10
   *     0 <= y <= 10
   *   End
   * `);
   * 
   * if (result.status === Status.OPTIMAL) {
   *   console.log('Optimal value:', result.objective);
   *   console.log('x =', result.variables.x);
   *   console.log('y =', result.variables.y);
   * }
   * ```
   */
  export function solve(problem: string, options?: SolveOptions): Promise<Solution>;

  /**
   * Solve a minimization problem
   * Convenience wrapper that ensures minimization
   */
  export function minimize(problem: string, options?: SolveOptions): Promise<Solution>;

  /**
   * Solve a maximization problem
   * Convenience wrapper that ensures maximization
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

  // Worker API

  /**
   * Initialize SCIP in a Web Worker
   */
  export function initWorker(options?: InitOptions): Promise<void>;

  /**
   * Solve in a Web Worker (non-blocking)
   */
  export function solveInWorker(problem: string, options?: SolveOptions): Promise<Solution>;

  /**
   * Minimize in a Web Worker
   */
  export function minimizeInWorker(problem: string, options?: SolveOptions): Promise<Solution>;

  /**
   * Maximize in a Web Worker
   */
  export function maximizeInWorker(problem: string, options?: SolveOptions): Promise<Solution>;

  /**
   * Terminate the Web Worker
   */
  export function terminateWorker(): void;

  /**
   * Worker solver instance
   */
  export interface WorkerSolver {
    solve(problem: string, options?: SolveOptions): Promise<Solution>;
    minimize(problem: string, options?: SolveOptions): Promise<Solution>;
    maximize(problem: string, options?: SolveOptions): Promise<Solution>;
    version(): Promise<string>;
    isReady(): Promise<boolean>;
    terminate(): void;
  }

  /**
   * Create a worker-based solver instance
   * Use for long-running optimizations to avoid blocking the main thread
   */
  export function createWorkerSolver(options?: InitOptions): Promise<WorkerSolver>;

  // Default export
  const SCIP: {
    init: typeof init;
    isReady: typeof isReady;
    solve: typeof solve;
    minimize: typeof minimize;
    maximize: typeof maximize;
    version: typeof version;
    getParameters: typeof getParameters;
    Status: typeof Status;
  };

  export default SCIP;
}

// LP Format Problem Helper Types
declare module 'scip.js/lp' {
  /**
   * LP Problem builder (optional convenience API)
   */
  export interface LPProblem {
    minimize(expression: string): LPProblem;
    maximize(expression: string): LPProblem;
    subjectTo(name: string, constraint: string): LPProblem;
    bounds(variable: string, lower?: number, upper?: number): LPProblem;
    binary(...variables: string[]): LPProblem;
    integer(...variables: string[]): LPProblem;
    general(...variables: string[]): LPProblem;
    toString(): string;
  }

  export function createProblem(): LPProblem;
}
