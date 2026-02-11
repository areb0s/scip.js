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
  /** 
   * Input format (default: 'lp')
   * - 'lp': LP format (linear problems only)
   * - 'mps': MPS format (linear problems only)
   * - 'zpl': ZIMPL format (supports MINLP, nonlinear expressions)
   * - 'cip': CIP format (SCIP's native format)
   */
  format?: 'lp' | 'mps' | 'zpl' | 'cip';
  /** Time limit in seconds (default: 3600) */
  timeLimit?: number;
  /** Relative gap for MIP (e.g., 0.01 for 1%) */
  gap?: number | null;
  /** Enable verbose output */
  verbose?: boolean;
  /** Additional SCIP parameters */
  parameters?: Record<string, string | number | boolean>;
  /** 
   * Initial solution hint for warm start
   * Object mapping variable names to values
   * @example { "x$sun#0": 1, "x$moon#5": 1 }
   */
  initialSolution?: Record<string, number> | null;
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

// ============================================
// Callback API Types
// ============================================

/**
 * Callback API solution status (same values, different export)
 */
export const ApiStatus: typeof Status;

/**
 * Callback API solver options (extends base options with callback features)
 */
export interface CallbackSolveOptions extends SolveOptions {
  /** Initial solution hint for warm start */
  initialSolution?: Record<string, number>;
  /** Cutoff bound - prune nodes with worse objective */
  cutoff?: number;
}

/**
 * Node callback data
 */
export interface NodeCallbackData {
  /** Current dual (lower) bound */
  dualBound: number;
  /** Current primal (upper) bound */
  primalBound: number;
  /** Number of nodes processed */
  nodes: number;
}

/**
 * Callback API statistics (extended)
 */
export interface CallbackStatistics {
  /** Solving time in seconds */
  solvingTime: number;
  /** Number of branch-and-bound nodes */
  nodes: number;
  /** Final optimality gap */
  gap: number;
  /** Final dual bound */
  dualBound: number;
  /** Final primal bound */
  primalBound: number;
}

/**
 * Callback API solution result
 */
export interface CallbackSolution {
  /** Solution status */
  status: StatusType;
  /** Objective function value */
  objective: number;
  /** Variable values */
  variables: Record<string, number>;
  /** Solver statistics */
  statistics: CallbackStatistics;
  /** Error message (if status is ERROR) */
  error?: string;
}

/**
 * Incumbent callback function type
 * Called when a new best solution is found during solving
 */
export type IncumbentCallback = (objectiveValue: number) => void;

/**
 * Node callback function type
 * Called when a node is selected for processing
 */
export type NodeCallback = (data: NodeCallbackData) => void;
export type PricerCallback = () => void;

export type PricingMode = 0 | 1 | 2;

/**
 * SCIP API class with callback support
 * 
 * @example
 * ```typescript
 * import { SCIPApi } from 'scip.js';
 * 
 * const scip = new SCIPApi();
 * await scip.init();
 * 
 * // Set callback for new incumbent solutions
 * scip.onIncumbent((objValue) => {
 *   console.log('New solution found:', objValue);
 *   // Could update cutoff here for custom pruning
 * });
 * 
 * const result = await scip.solve(problemZPL, {
 *   format: 'zpl',
 *   initialSolution: { x: 1, y: 0 },
 *   cutoff: 100
 * });
 * 
 * scip.destroy();
 * ```
 */
export class SCIPApi {
  constructor();
  
  /**
   * Initialize SCIP API module
   * @param options - Initialization options
   */
  init(options?: InitOptions): Promise<void>;
  
  /**
   * Set callback for new incumbent solutions
   * Called whenever SCIP finds a new best solution
   * @param callback - Function receiving the objective value
   */
  onIncumbent(callback: IncumbentCallback | null): void;
  
  /**
   * Set callback for node processing (progress tracking)
   * @param callback - Function receiving dual/primal bounds and node count
   */
  onNode(callback: NodeCallback | null): void;
  onPricerRedcost(callback: PricerCallback | null): void;
  onPricerFarkas(callback: PricerCallback | null): void;

  getStage(): number;
  hasCurrentNodeLP(): boolean;
  getLPSolstat(): number;
  getPricingMode(): PricingMode;
  isSafeFarkasContext(): boolean;
  isTransformed(): boolean;

  findVarId(name: string): number;
  findConsId(name: string): number;
  getTransformedVarId(varId: number): number;
  getTransformedConsId(consId: number): number;

  getConsRowId(consId: number): number;
  isConsInLP(consId: number): boolean;
  getConsDualLinear(consId: number): number;
  getConsFarkasLinear(consId: number): number;

  getRowDual(rowId: number): number;
  getRowFarkas(rowId: number): number;
  getRowLhs(rowId: number): number;
  getRowRhs(rowId: number): number;
  getRowLPPos(rowId: number): number;
  isRowInLP(rowId: number): boolean;
  isRowLocal(rowId: number): boolean;
  getRowName(rowId: number): string;

  getNLProws(): number;
  getLPRowDualsBatch(n: number): number[];
  getLPRowFarkasBatch(n: number): number[];
  getVarLPValue(varId: number): number;
  getVarRedcost(varId: number): number;

  addVarToRowsBatch(varId: number, rowIds: number[], vals: number[]): boolean;
  addVarToConssBatch(varId: number, consIds: number[], vals: number[]): boolean;
  includePricer(options?: {
    name?: string;
    desc?: string;
    priority?: number;
    delay?: boolean;
  }): boolean;
  activatePricer(): boolean;
  deactivatePricer(): boolean;
  isPricerActive(): boolean;
  setPricerResult(resultCode: number): void;
  setPricerLowerbound(value: number): void;
  setPricerStopEarly(flag: boolean): void;
  abortPricingRound(): void;
  getAddedPricedVarCountThisCall(): number;
  getLastPricingResult(): number;
  getLastPricingMode(): number;
  getPricerRedcostCalls(): number;
  getPricerFarkasCalls(): number;
  getPricerRound(): number;
  getResultCodeSuccess(): number;
  getResultCodeDidNotRun(): number;
  getResultCodeDidNotFind(): number;
  setParamInt(name: string, value: number): boolean;
  setParamReal(name: string, value: number): boolean;
  setParamBool(name: string, value: boolean): boolean;
  setParamString(name: string, value: string): boolean;
  addPricedVar(options: {
    name: string;
    lb?: number;
    ub?: number;
    obj?: number;
    vartype?: number;
    initial?: number;
    removable?: number;
  }): number;
  getAddedPricedVarCount(): number;
  writeLP(path: string): boolean;
  writeLPSnapshot(prefix?: string): boolean;
  writeMIP(path: string, genericNames?: boolean, origObj?: boolean, lazyConss?: boolean): boolean;
  clearProblem(): boolean;
  beginProblem(options?: { name?: string; maximize?: boolean }): boolean;
  addLinearCons(options: {
    name: string;
    lhs?: number;
    rhs?: number;
    initial?: boolean;
    separate?: boolean;
    enforce?: boolean;
    check?: boolean;
    propagate?: boolean;
    local?: boolean;
    modifiable?: boolean;
    dynamic?: boolean;
    removable?: boolean;
    stickingAtNode?: boolean;
  }): number;
  setConsModifiable(consId: number, modifiable: boolean): boolean;
  addVar(options: {
    name: string;
    lb?: number;
    ub?: number;
    obj?: number;
    vartype?: number;
    initial?: number;
    removable?: number;
  }): number;
  addCoefLinear(consId: number, varId: number, val: number): boolean;
  addCoefLinearBatch(consId: number, varIds: number[], vals: number[]): boolean;
  solveCurrentModel(options?: CallbackSolveOptions): Promise<CallbackSolution>;
  
  /**
   * Solve an optimization problem
   * @param problem - Problem definition string
   * @param options - Solver options including callbacks
   * @returns Solution with statistics
   */
  solve(problem: string, options?: CallbackSolveOptions): Promise<CallbackSolution>;
  
  /**
   * Free SCIP resources
   * Call this when done to release memory
   */
  destroy(): void;
}

/**
 * Convenience function to solve with callbacks
 * Creates SCIPApi, solves, and destroys automatically
 * 
 * @example
 * ```typescript
 * const result = await solveWithCallbacks(problem, {
 *   format: 'zpl',
 *   onIncumbent: (obj) => console.log('New best:', obj),
 *   onNode: (data) => console.log('Progress:', data.nodes)
 * });
 * ```
 */
export function solveWithCallbacks(
  problem: string, 
  options?: CallbackSolveOptions & {
    onIncumbent?: IncumbentCallback;
    onNode?: NodeCallback;
  }
): Promise<CallbackSolution>;

/**
 * Create a callback-enabled solver instance
 * Use when you need incumbent callbacks for custom pruning logic
 */
export function createCallbackSolver(options?: InitOptions): Promise<SCIPApi>;

// Global declaration for CDN usage
declare global {
  interface Window {
    SCIP: SCIPModule;
    SCIP_BASE_URL?: string;
  }
  
  var SCIP: SCIPModule;
  var SCIP_BASE_URL: string | undefined;
}
