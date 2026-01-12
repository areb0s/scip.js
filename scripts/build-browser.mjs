#!/usr/bin/env node
/**
 * Build browser-compatible IIFE bundle for SCIP.js
 * 
 * This script creates dist/scip.browser.js which can be loaded via:
 *   <script src="scip.browser.js"></script>
 *   <script>
 *     const result = await SCIP.solve(`...`);
 *   </script>
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'src');
const distDir = join(rootDir, 'dist');

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));
const VERSION = packageJson.version;

/**
 * Transform ES6 scip-core.js to IIFE-compatible version
 * - Remove import.meta.url dependency
 * - Remove export default
 * - Make createSCIP a regular variable
 */
function transformScipCore() {
  const scipCorePath = join(distDir, 'scip-core.js');
  let content = readFileSync(scipCorePath, 'utf-8');
  
  // Replace ALL occurrences of import.meta.url with __SCIP_SCRIPT_DIR__
  // This handles both:
  //   1. var _scriptDir = import.meta.url;
  //   2. new URL("scip.wasm", import.meta.url).href
  content = content.replace(/import\.meta\.url/g, '__SCIP_SCRIPT_DIR__');
  
  // Remove the ES6 export default at the end
  // The original looks like: export default createSCIP;
  content = content.replace(/export default createSCIP;?\s*$/m, '');
  
  return content;
}

/**
 * Create IIFE wrapper for scip-wrapper.js that doesn't use dynamic import
 */
function createBrowserWrapper() {
  return `
/**
 * SCIP.js Browser Bundle
 * Supports: LP, MIP, MINLP (Mixed Integer Nonlinear Programming)
 */
(function(global) {
  'use strict';
  
  // Script directory detection for WASM loading
  var __SCIP_SCRIPT_DIR__ = (function() {
    // Check for explicit SCIP_BASE_URL
    if (typeof SCIP_BASE_URL !== 'undefined' && SCIP_BASE_URL) {
      return SCIP_BASE_URL + (SCIP_BASE_URL.endsWith('/') ? '' : '/');
    }
    // Try to detect from current script
    if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
      var src = document.currentScript.src;
      return src.substring(0, src.lastIndexOf('/') + 1);
    }
    // Default CDN (npm)
    return 'https://cdn.jsdelivr.net/npm/@areb0s/scip.js@${VERSION}/dist/';
  })();

  // Inline the transformed scip-core.js (createSCIP factory function)
  // __SCIP_CORE_PLACEHOLDER__
  
  // SCIP wrapper implementation
  var scipModule = null;
  var isInitialized = false;
  var initPromise = null;
  var readyResolve = null;
  var readyReject = null;
  
  // Exception tracking for debugging WASM crashes
  var lastAbortReason = null;
  var lastExitCode = null;
  
  var readyPromise = new Promise(function(resolve, reject) {
    readyResolve = resolve;
    readyReject = reject;
  });
  
  var Status = {
    OPTIMAL: 'optimal',
    INFEASIBLE: 'infeasible',
    UNBOUNDED: 'unbounded',
    TIME_LIMIT: 'timelimit',
    UNKNOWN: 'unknown',
    ERROR: 'error'
  };
  
  function parseStatus(output) {
    if (output.includes('optimal solution found')) return Status.OPTIMAL;
    if (output.includes('problem is infeasible')) return Status.INFEASIBLE;
    if (output.includes('problem is unbounded')) return Status.UNBOUNDED;
    if (output.includes('time limit reached')) return Status.TIME_LIMIT;
    return Status.UNKNOWN;
  }
  
  function parseSolution(output) {
    var variables = {};
    var objective = { value: null };
    
    var objMatch = output.match(/objective value:\\s*([\\d.e+-]+)/i);
    if (objMatch) {
      objective.value = parseFloat(objMatch[1]);
    }
    
    // ZIMPL 변수명은 x$sun#0 처럼 $, # 포함 가능
    // \\S+ 로 공백 아닌 모든 문자 매칭
    var varRegex = /^(\\S+)\\s+([\\d.e+-]+)/gm;
    var match;
    var solSection = output.split('solution:')[1] || output;
    
    while ((match = varRegex.exec(solSection)) !== null) {
      var name = match[1];
      var value = parseFloat(match[2]);
      if (!isNaN(value) && name !== 'objective') {
        variables[name] = value;
      }
    }
    
    return { variables: variables, objective: objective };
  }
  
  function parseStatistics(output) {
    var stats = { solvingTime: null, nodes: null, iterations: null, gap: null };
    
    var timeMatch = output.match(/Solving Time \\(sec\\)\\s*:\\s*([\\d.]+)/);
    if (timeMatch) stats.solvingTime = parseFloat(timeMatch[1]);
    
    var nodesMatch = output.match(/Nodes\\s*:\\s*(\\d+)/);
    if (nodesMatch) stats.nodes = parseInt(nodesMatch[1]);
    
    var iterMatch = output.match(/LP Iterations\\s*:\\s*(\\d+)/);
    if (iterMatch) stats.iterations = parseInt(iterMatch[1]);
    
    var gapMatch = output.match(/Gap\\s*:\\s*([\\d.]+)\\s*%/);
    if (gapMatch) stats.gap = parseFloat(gapMatch[1]);
    
    return stats;
  }
  
  function init(options) {
    options = options || {};
    
    if (isInitialized) {
      return Promise.resolve();
    }
    if (initPromise) {
      return initPromise;
    }
    
    initPromise = new Promise(function(resolve, reject) {
      try {
        var wasmPath = options.wasmPath || (__SCIP_SCRIPT_DIR__ + 'scip.wasm');
        
        createSCIP({
          locateFile: function(path) {
            if (path.endsWith('.wasm')) {
              return wasmPath;
            }
            return path;
          },
          print: function(text) {
            if (scipModule && scipModule.onStdout) {
              scipModule.onStdout(text);
            }
          },
          printErr: function(text) {
            if (scipModule && scipModule.onStderr) {
              scipModule.onStderr(text);
            }
          },
          // Capture abort/exit reasons for better error messages
          onAbort: function(reason) {
            lastAbortReason = reason;
            console.error('[SCIP WASM Abort]', reason);
          },
          onExit: function(code) {
            lastExitCode = code;
            if (code !== 0) {
              console.error('[SCIP WASM Exit]', code);
            }
          }
        }).then(function(module) {
          scipModule = module;
          
          if (scipModule.FS) {
            try { scipModule.FS.mkdir('/problems'); } catch (e) {}
            try { scipModule.FS.mkdir('/solutions'); } catch (e) {}
            try { scipModule.FS.mkdir('/settings'); } catch (e) {}
          }
          
          isInitialized = true;
          if (readyResolve) readyResolve();
          resolve();
        }).catch(function(err) {
          console.error('[SCIP.js] WASM loading failed:', err);
          console.error('[SCIP.js] Attempted WASM path:', wasmPath);
          console.error('[SCIP.js] Make sure the WASM file is accessible at this URL.');
          console.error('[SCIP.js] You can set window.SCIP_BASE_URL before loading this script to specify a custom path.');
          var error = new Error('SCIP WASM loading failed: ' + (err.message || err) + '. WASM path: ' + wasmPath);
          if (readyReject) readyReject(error);
          reject(error);
        });
      } catch (err) {
        console.error('[SCIP.js] Initialization error:', err);
        if (readyReject) readyReject(err);
        reject(err);
      }
    });
    
    return initPromise;
  }
  
  function solve(problem, options) {
    options = options || {};
    
    var doSolve = function() {
      var format = options.format || 'lp';
      var timeLimit = options.timeLimit || 3600;
      var gap = options.gap || null;
      var verbose = options.verbose || false;
      var parameters = options.parameters || {};
      
      var stdout = '';
      var stderr = '';
      
      scipModule.onStdout = function(text) {
        stdout += text + '\\n';
        if (verbose) console.log('[SCIP]', text);
      };
      
      scipModule.onStderr = function(text) {
        stderr += text + '\\n';
        if (verbose) console.error('[SCIP Error]', text);
      };
      
      try {
        var formatExtMap = { mps: 'mps', zpl: 'zpl', cip: 'cip', lp: 'lp' };
        var ext = formatExtMap[format] || 'lp';
        var problemFile = '/problems/problem.' + ext;
        var solutionFile = '/solutions/solution.sol';
        
        scipModule.FS.writeFile(problemFile, problem);
        
        var commands = [];
        commands.push('set limits time ' + timeLimit);
        
        if (gap !== null) {
          commands.push('set limits gap ' + gap);
        }
        
        for (var key in parameters) {
          if (parameters.hasOwnProperty(key)) {
            commands.push('set ' + key + ' ' + parameters[key]);
          }
        }
        
        commands.push('read ' + problemFile);
        commands.push('optimize');
        commands.push('display solution');
        commands.push('write solution ' + solutionFile);
        commands.push('display statistics');
        commands.push('quit');
        
        var settingsContent = commands.join('\\n');
        scipModule.FS.writeFile('/settings/commands.txt', settingsContent);
        
        var exitCode = scipModule.callMain(['-b', '/settings/commands.txt']);
        
        var status = parseStatus(stdout);
        var parsed = parseSolution(stdout);
        var statistics = parseStatistics(stdout);
        
        var rawSolution = null;
        try {
          rawSolution = scipModule.FS.readFile(solutionFile, { encoding: 'utf8' });
        } catch (e) {}
        
        // Cleanup
        var cleanupFiles = [
          '/problems/problem.lp', '/problems/problem.mps',
          '/problems/problem.zpl', '/problems/problem.cip',
          '/solutions/solution.sol', '/settings/commands.txt'
        ];
        for (var i = 0; i < cleanupFiles.length; i++) {
          try { scipModule.FS.unlink(cleanupFiles[i]); } catch (e) {}
        }
        
        return {
          status: status,
          objective: parsed.objective.value,
          variables: parsed.variables,
          statistics: statistics,
          exitCode: exitCode,
          output: verbose ? stdout : undefined,
          rawSolution: rawSolution
        };
        
      } catch (error) {
        // Attempt to extract detailed exception message from WASM
        var errorMessage = error.message || String(error);
        var exceptionInfo = null;
        
        // Check if this is a WASM exception (pointer address)
        if (typeof error === 'number' || /^\\d+$/.test(String(error))) {
          var ptr = typeof error === 'number' ? error : parseInt(String(error), 10);
          
          // Try to get exception message using Emscripten's exception handling
          if (scipModule) {
            try {
              // Modern Emscripten exception handling
              if (typeof scipModule.getExceptionMessage === 'function') {
                exceptionInfo = scipModule.getExceptionMessage(ptr);
                errorMessage = 'WASM Exception: ' + exceptionInfo;
              } else if (typeof scipModule.UTF8ToString === 'function') {
                // Fallback: try to read as string from memory
                try {
                  var str = scipModule.UTF8ToString(ptr);
                  if (str && str.length > 0 && str.length < 1000) {
                    exceptionInfo = str;
                    errorMessage = 'WASM Exception: ' + str;
                  }
                } catch (e) { /* not a valid string pointer */ }
              }
            } catch (e) {
              console.error('[SCIP] Failed to get exception message:', e);
            }
          }
          
          if (!exceptionInfo) {
            errorMessage = 'WASM Exception (ptr: ' + ptr + '). Enable exception handling in build for details.';
          }
        }
        
        return {
          status: Status.ERROR,
          error: errorMessage,
          errorDetails: {
            rawError: String(error),
            exceptionInfo: exceptionInfo,
            abortReason: lastAbortReason,
            exitCode: lastExitCode,
            type: typeof error,
            stdout: stdout,
            stderr: stderr
          },
          output: stdout + stderr
        };
      }
      
      // Reset exception tracking after solve
      lastAbortReason = null;
      lastExitCode = null;
    };
    
    if (!isInitialized) {
      return init(options).then(doSolve);
    }
    return Promise.resolve(doSolve());
  }
  
  function minimize(problem, options) {
    if (!problem.toLowerCase().includes('minimize')) {
      problem = 'Minimize\\n' + problem;
    }
    return solve(problem, options);
  }
  
  function maximize(problem, options) {
    if (!problem.toLowerCase().includes('maximize')) {
      problem = 'Maximize\\n' + problem;
    }
    return solve(problem, options);
  }
  
  function version() {
    var getVersion = function() {
      var output = '';
      scipModule.onStdout = function(text) { output += text + '\\n'; };
      scipModule.callMain(['--version']);
      return output.trim();
    };
    
    if (!isInitialized) {
      return init().then(getVersion);
    }
    return Promise.resolve(getVersion());
  }
  
  function isReady() {
    return isInitialized;
  }
  
  // Expose SCIP API
  var SCIP = {
    init: init,
    ready: readyPromise,
    isReady: isReady,
    solve: solve,
    minimize: minimize,
    maximize: maximize,
    version: version,
    Status: Status
  };
  
  global.SCIP = SCIP;
  
  // Auto-initialize
  init().catch(function(err) {
    console.error('[SCIP.js] Auto-initialization failed:', err.message);
  });
  
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
`;
}

async function build() {
  console.log('Building browser bundle...\n');

  try {
    // Read and transform scip-core.js
    const scipCore = transformScipCore();
    
    // Create the browser wrapper
    let browserBundle = createBrowserWrapper();
    
    // Insert the transformed scip-core.js
    browserBundle = browserBundle.replace(
      '// __SCIP_CORE_PLACEHOLDER__',
      scipCore
    );
    
    // Replace version placeholder
    browserBundle = browserBundle.replace('${VERSION}', VERSION);
    
    // Write unminified version
    writeFileSync(join(distDir, 'scip.js'), browserBundle);
    console.log('  dist/scip.js      ' + (browserBundle.length / 1024).toFixed(1) + 'kb');
    
    // Create minified version using esbuild
    const minified = await esbuild.transform(browserBundle, {
      minify: true,
      target: 'es2020',
    });
    
    writeFileSync(join(distDir, 'scip.min.js'), minified.code);
    console.log('  dist/scip.min.js  ' + (minified.code.length / 1024).toFixed(1) + 'kb');
    
    console.log('\nDone! Usage:');
    console.log('  <script src="scip.min.js"></script>');
    console.log('  <script>');
    console.log('    await SCIP.ready;');
    console.log('    const result = await SCIP.solve(`...`);');
    console.log('  </script>');

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
