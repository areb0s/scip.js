/**
 * SCIP.js - SCIP Optimization Solver for JavaScript
 * High-level wrapper around SCIP WASM
 *
 * Supports: LP, MIP, MINLP (Mixed Integer Nonlinear Programming)
 *
 * Usage in Worker (like OpenCV):
 *   // Set base URL before loading script
 *   self.SCIP_BASE_URL = 'https://cdn.jsdelivr.net/gh/user/scip.js@v1.0.0/dist/';
 *
 *   // Load and execute script
 *   const response = await fetch(SCIP_BASE_URL + 'scip.min.js');
 *   new Function(await response.text())();
 *
 *   // Wait for initialization
 *   await self.SCIP.ready;
 *
 *   // Use
 *   const result = await self.SCIP.solve(`...`);
 */

let scipModule = null;
let isInitialized = false;
let initPromise = null;
let readyResolve = null;
let readyReject = null;

/**
 * Ready promise - resolves when SCIP is initialized
 * Usage: await SCIP.ready;
 */
export const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

/**
 * Default CDN base URL for WASM files
 * Using npm CDN with specific version to ensure JS/WASM version consistency
 */
const DEFAULT_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/@areb0s/scip.js@latest/dist/";

/**
 * Get base URL from global SCIP_BASE_URL or default CDN
 */
function getBaseUrl() {
  // Safe check for global scope (works in browser, worker, and SSR)
  const globalScope =
    (typeof globalThis !== "undefined" && globalThis) ||
    (typeof self !== "undefined" && self) ||
    (typeof window !== "undefined" && window) ||
    {};

  // Check for explicit SCIP_BASE_URL
  if (globalScope.SCIP_BASE_URL) {
    return globalScope.SCIP_BASE_URL;
  }

  // Check for __importMetaUrl (set by bundler)
  if (
    typeof __importMetaUrl !== "undefined" &&
    __importMetaUrl &&
    !__importMetaUrl.startsWith("blob:")
  ) {
    return __importMetaUrl.substring(0, __importMetaUrl.lastIndexOf("/") + 1);
  }

  // Default to CDN
  return DEFAULT_CDN_BASE;
}

/**
 * Solution status enum
 */
export const Status = {
  OPTIMAL: "optimal",
  INFEASIBLE: "infeasible",
  UNBOUNDED: "unbounded",
  TIME_LIMIT: "timelimit",
  UNKNOWN: "unknown",
  ERROR: "error",
};

/**
 * Parse SCIP status from output
 */
function parseStatus(output) {
  if (output.includes("optimal solution found")) return Status.OPTIMAL;
  if (output.includes("problem is infeasible")) return Status.INFEASIBLE;
  if (output.includes("problem is unbounded")) return Status.UNBOUNDED;
  if (output.includes("time limit reached")) return Status.TIME_LIMIT;
  return Status.UNKNOWN;
}

/**
 * Parse solution values from SCIP output
 */
function parseSolution(output) {
  const variables = {};
  const objective = { value: null, sense: null };

  // Parse objective value
  const objMatch = output.match(/objective value:\s*([\d.e+-]+)/i);
  if (objMatch) {
    objective.value = parseFloat(objMatch[1]);
  }

  // Parse variable values from solution display
  // Format: variable_name    value    (obj:coef)
  const varRegex = /^(\w+)\s+([\d.e+-]+)/gm;
  let match;

  // Look for solution section
  const solSection = output.split("solution:")[1] || output;

  while ((match = varRegex.exec(solSection)) !== null) {
    const name = match[1];
    const value = parseFloat(match[2]);
    if (!isNaN(value) && name !== "objective") {
      variables[name] = value;
    }
  }

  return { variables, objective };
}

/**
 * Parse statistics from SCIP output
 */
function parseStatistics(output) {
  const stats = {
    solvingTime: null,
    nodes: null,
    iterations: null,
    gap: null,
  };

  const timeMatch = output.match(/Solving Time \(sec\)\s*:\s*([\d.]+)/);
  if (timeMatch) stats.solvingTime = parseFloat(timeMatch[1]);

  const nodesMatch = output.match(/Nodes\s*:\s*(\d+)/);
  if (nodesMatch) stats.nodes = parseInt(nodesMatch[1]);

  const iterMatch = output.match(/LP Iterations\s*:\s*(\d+)/);
  if (iterMatch) stats.iterations = parseInt(iterMatch[1]);

  const gapMatch = output.match(/Gap\s*:\s*([\d.]+)\s*%/);
  if (gapMatch) stats.gap = parseFloat(gapMatch[1]);

  return stats;
}

/**
 * Initialize SCIP WASM module
 * @param {Object} options - Initialization options
 * @param {string} options.wasmPath - Path to scip.wasm file
 * @returns {Promise<void>}
 */
export async function init(options = {}) {
  if (isInitialized) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Auto-detect wasmPath from SCIP_BASE_URL or script location
      const baseUrl = getBaseUrl();
      const wasmPath = options.wasmPath || baseUrl + "scip.wasm";

      // Dynamic import of the Emscripten-generated module
      const createSCIP = (await import("./scip-core.js")).default;

      scipModule = await createSCIP({
        locateFile: (path) => {
          if (path.endsWith(".wasm")) {
            return wasmPath;
          }
          return path;
        },
        // Capture stdout/stderr from Emscripten
        print: (text) => {
          if (scipModule && scipModule.onStdout) {
            scipModule.onStdout(text);
          }
        },
        printErr: (text) => {
          if (scipModule && scipModule.onStderr) {
            scipModule.onStderr(text);
          }
        },
      });

      // Create directories for problems, solutions, settings
      if (scipModule.FS) {
        try {
          scipModule.FS.mkdir("/problems");
        } catch (e) {
          /* exists */
        }
        try {
          scipModule.FS.mkdir("/solutions");
        } catch (e) {
          /* exists */
        }
        try {
          scipModule.FS.mkdir("/settings");
        } catch (e) {
          /* exists */
        }
      }

      isInitialized = true;

      // Resolve ready promise
      if (readyResolve) {
        readyResolve();
      }
    } catch (error) {
      if (readyReject) {
        readyReject(error);
      }
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Check if SCIP is initialized
 * @returns {boolean}
 */
export function isReady() {
  return isInitialized;
}

/**
 * Solve an optimization problem
 *
 * Supports LP, MIP, and MINLP (Mixed Integer Nonlinear Programming) problems.
 *
 * @param {string} problem - Problem definition in one of the supported formats
 * @param {Object} options - Solver options
 * @param {string} options.format - Input format: 'lp', 'mps', 'zpl', 'cip' (default: 'lp')
 *   - 'lp': LP format (linear problems)
 *   - 'mps': MPS format (linear problems)
 *   - 'zpl': ZIMPL format (supports MINLP with nonlinear expressions)
 *   - 'cip': CIP format (SCIP's native format, supports all constraint types)
 * @param {number} options.timeLimit - Time limit in seconds
 * @param {number} options.gap - Relative gap for MIP (e.g., 0.01 for 1%)
 * @param {boolean} options.verbose - Enable verbose output
 * @param {Object} options.parameters - Additional SCIP parameters
 * @returns {Promise<Object>} Solution object
 *
 * @example
 * // LP format (linear)
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
 * @example
 * // ZIMPL format (MINLP with nonlinear)
 * const result = await solve(`
 *   var x >= 0 <= 10;
 *   var y >= 0 <= 10;
 *   minimize cost: x^2 + y^2;
 *   subto c1: x + y >= 1;
 * `, { format: 'zpl' });
 *
 * console.log(result.status);      // 'optimal'
 * console.log(result.objective);   // 1.0
 * console.log(result.variables);   // { x: 1, y: 0 }
 */
export async function solve(problem, options = {}) {
  if (!isInitialized) {
    await init(options);
  }

  const {
    format = "lp",
    timeLimit = 3600,
    gap = null,
    verbose = false,
    parameters = {},
  } = options;

  // Capture output
  let stdout = "";
  let stderr = "";

  scipModule.onStdout = (text) => {
    stdout += text + "\n";
    if (verbose) console.log("[SCIP]", text);
  };

  scipModule.onStderr = (text) => {
    stderr += text + "\n";
    if (verbose) console.error("[SCIP Error]", text);
  };

  try {
    // Determine file extension based on format
    const formatExtMap = { mps: "mps", zpl: "zpl", cip: "cip", lp: "lp" };
    const ext = formatExtMap[format] || "lp";
    const problemFile = `/problems/problem.${ext}`;
    const solutionFile = "/solutions/solution.sol";

    // Write problem to virtual filesystem
    scipModule.FS.writeFile(problemFile, problem);

    // Build SCIP command
    const commands = [];

    // Set parameters
    commands.push(`set limits time ${timeLimit}`);

    if (gap !== null) {
      commands.push(`set limits gap ${gap}`);
    }

    // Custom parameters
    for (const [key, value] of Object.entries(parameters)) {
      commands.push(`set ${key} ${value}`);
    }

    // Read and solve
    commands.push(`read ${problemFile}`);
    commands.push("optimize");
    commands.push("display solution");
    commands.push(`write solution ${solutionFile}`);
    commands.push("display statistics");
    commands.push("quit");

    // Write settings file
    const settingsContent = commands.join("\n");
    scipModule.FS.writeFile("/settings/commands.txt", settingsContent);

    // Run SCIP with batch mode
    const exitCode = scipModule.callMain(["-b", "/settings/commands.txt"]);

    // Parse results
    const status = parseStatus(stdout);
    const { variables, objective } = parseSolution(stdout);
    const statistics = parseStatistics(stdout);

    // Try to read solution file
    let rawSolution = null;
    try {
      rawSolution = scipModule.FS.readFile(solutionFile, { encoding: "utf8" });
    } catch (e) {
      // Solution file may not exist if infeasible
    }

    return {
      status,
      objective: objective.value,
      variables,
      statistics,
      exitCode,
      output: verbose ? stdout : undefined,
      rawSolution,
    };
  } catch (error) {
    return {
      status: Status.ERROR,
      error: error?.message || String(error) || "Unknown error",
      output: stdout + stderr,
    };
  } finally {
    // Cleanup all possible problem files
    const cleanupFiles = [
      "/problems/problem.lp",
      "/problems/problem.mps",
      "/problems/problem.zpl",
      "/problems/problem.cip",
      "/solutions/solution.sol",
      "/settings/commands.txt",
    ];
    for (const file of cleanupFiles) {
      try {
        scipModule.FS.unlink(file);
      } catch (e) {}
    }
  }
}

/**
 * Solve a minimization problem
 * Convenience wrapper that ensures minimization
 */
export async function minimize(problem, options = {}) {
  // LP format uses "Minimize" keyword, ensure it's present
  if (!problem.toLowerCase().includes("minimize")) {
    problem = "Minimize\n" + problem;
  }
  return solve(problem, options);
}

/**
 * Solve a maximization problem
 * Convenience wrapper that ensures maximization
 */
export async function maximize(problem, options = {}) {
  // LP format uses "Maximize" keyword
  if (!problem.toLowerCase().includes("maximize")) {
    problem = "Maximize\n" + problem;
  }
  return solve(problem, options);
}

/**
 * Get SCIP version info
 */
export async function version() {
  if (!isInitialized) {
    await init();
  }

  let output = "";
  scipModule.onStdout = (text) => {
    output += text + "\n";
  };

  scipModule.callMain(["--version"]);

  return output.trim();
}

/**
 * Get available SCIP parameters
 */
export async function getParameters() {
  if (!isInitialized) {
    await init();
  }

  let output = "";
  scipModule.onStdout = (text) => {
    output += text + "\n";
  };

  scipModule.FS.writeFile("/settings/params.txt", "set\nquit\n");
  scipModule.callMain(["-b", "/settings/params.txt"]);

  return output;
}

// Default export
export default {
  init,
  ready,
  isReady,
  solve,
  minimize,
  maximize,
  version,
  getParameters,
  Status,
};
