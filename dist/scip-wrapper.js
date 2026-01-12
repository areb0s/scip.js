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

// Exception tracking for debugging WASM crashes
let lastAbortReason = null;
let lastExitCode = null;

/**
 * Ready promise - resolves when SCIP is initialized
 * Usage: await SCIP.ready;
 */
export const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

// Read version from package.json
const packageJson = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf-8")
);
const VERSION = packageJson.version;

/**
 * Default CDN base URL for WASM files
 */
const DEFAULT_CDN_BASE = `https://cdn.jsdelivr.net/npm/@areb0s/scip.js@${VERSION}/dist/`;

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
 * @param {string} output - stdout from SCIP
 * @param {string} rawSolution - solution file content (more reliable)
 */
function parseSolution(output, rawSolution = null) {
  const variables = {};
  const objective = { value: null, sense: null };

  // Use rawSolution if available (more reliable)
  const solText = rawSolution || output;

  // Parse objective value
  const objMatch = solText.match(/objective value:\s*([\d.e+-]+)/i);
  if (objMatch) {
    objective.value = parseFloat(objMatch[1]);
  }

  // Parse variable values from solution display
  // Match ZIMPL-style variable names: x$sun#0, effSum$star#1, b_sun_10, etc.
  // Format: variableName    value    (obj:coef)
  const varRegex = /^([\w$#]+)\s+([\d.e+-]+)/gm;
  let match;

  while ((match = varRegex.exec(solText)) !== null) {
    const name = match[1];
    const value = parseFloat(match[2]);
    if (!isNaN(value) && name !== "objective" && name !== "solution") {
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
        // Capture abort/exit reasons for better error messages
        onAbort: (reason) => {
          lastAbortReason = reason;
          console.error("[SCIP WASM Abort]", reason);
        },
        onExit: (code) => {
          lastExitCode = code;
          if (code !== 0) {
            console.error("[SCIP WASM Exit]", code);
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

    // Try to read solution file first (more reliable for parsing)
    let rawSolution = null;
    try {
      rawSolution = scipModule.FS.readFile(solutionFile, { encoding: "utf8" });
    } catch (e) {
      // Solution file may not exist if infeasible
    }

    // Parse results
    const status = parseStatus(stdout);
    const { variables, objective } = parseSolution(stdout, rawSolution);
    const statistics = parseStatistics(stdout);

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
    // Attempt to extract detailed exception message from WASM
    let errorMessage = error.message || String(error);
    let exceptionInfo = null;

    // Check if this is a WASM exception (pointer address)
    if (typeof error === "number" || /^\d+$/.test(String(error))) {
      const ptr =
        typeof error === "number" ? error : parseInt(String(error), 10);

      // Try to get exception message using Emscripten's exception handling
      if (scipModule) {
        try {
          // Modern Emscripten exception handling
          if (typeof scipModule.getExceptionMessage === "function") {
            exceptionInfo = scipModule.getExceptionMessage(ptr);
            errorMessage = `WASM Exception: ${exceptionInfo}`;
          } else if (typeof scipModule.UTF8ToString === "function") {
            // Fallback: try to read as string from memory
            try {
              const str = scipModule.UTF8ToString(ptr);
              if (str && str.length > 0 && str.length < 1000) {
                exceptionInfo = str;
                errorMessage = `WASM Exception: ${str}`;
              }
            } catch (e) {
              /* not a valid string pointer */
            }
          }
        } catch (e) {
          console.error("[SCIP] Failed to get exception message:", e);
        }
      }

      if (!exceptionInfo) {
        errorMessage = `WASM Exception (ptr: ${ptr}). Enable exception handling in build for details.`;
      }
    }

    return {
      status: Status.ERROR,
      error: errorMessage,
      errorDetails: {
        rawError: String(error),
        exceptionInfo,
        abortReason: lastAbortReason,
        exitCode: lastExitCode,
        type: typeof error,
        stdout: stdout,
        stderr: stderr,
      },
      output: stdout + stderr,
    };
  } finally {
    // Reset exception tracking
    lastAbortReason = null;
    lastExitCode = null;
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
