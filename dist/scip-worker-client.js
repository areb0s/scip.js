/**
 * SCIP.js Worker Client
 * Provides the same API as scip-wrapper.js but runs in a Web Worker
 */

export const Status = {
  OPTIMAL: 'optimal',
  INFEASIBLE: 'infeasible',
  UNBOUNDED: 'unbounded',
  TIME_LIMIT: 'timelimit',
  UNKNOWN: 'unknown',
  ERROR: 'error'
};

let worker = null;
let messageId = 0;
let pendingMessages = new Map();
let workerReady = false;
let readyPromise = null;

/**
 * Create the worker and set up message handling
 */
function createWorker(workerPath = './scip-worker.js') {
  if (worker) return;
  
  worker = new Worker(workerPath, { type: 'module' });
  
  worker.onmessage = (e) => {
    const { id, type, payload } = e.data;
    
    if (type === 'ready') {
      workerReady = true;
      return;
    }
    
    const pending = pendingMessages.get(id);
    if (!pending) return;
    
    pendingMessages.delete(id);
    
    if (type === 'error') {
      pending.reject(new Error(payload.message));
    } else {
      pending.resolve(payload);
    }
  };
  
  worker.onerror = (error) => {
    console.error('[SCIP Worker Error]', error);
  };
}

/**
 * Send a message to the worker and wait for response
 */
function sendMessage(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pendingMessages.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

/**
 * Wait for worker to be ready
 */
function waitForReady() {
  if (workerReady) return Promise.resolve();
  
  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      const check = () => {
        if (workerReady) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }
  
  return readyPromise;
}

/**
 * Initialize SCIP worker
 */
export async function init(options = {}) {
  const workerPath = options.workerPath || './scip-worker.js';
  createWorker(workerPath);
  await waitForReady();
  return sendMessage('init', options);
}

/**
 * Check if SCIP is ready
 */
export async function isReady() {
  if (!worker) return false;
  return sendMessage('isReady', {});
}

/**
 * Solve an optimization problem
 */
export async function solve(problem, options = {}) {
  if (!worker) {
    await init(options.initOptions || {});
  }
  return sendMessage('solve', { problem, options });
}

/**
 * Solve a minimization problem
 */
export async function minimize(problem, options = {}) {
  if (!worker) {
    await init(options.initOptions || {});
  }
  return sendMessage('minimize', { problem, options });
}

/**
 * Solve a maximization problem
 */
export async function maximize(problem, options = {}) {
  if (!worker) {
    await init(options.initOptions || {});
  }
  return sendMessage('maximize', { problem, options });
}

/**
 * Get SCIP version
 */
export async function version() {
  if (!worker) {
    await init({});
  }
  return sendMessage('version', {});
}

/**
 * Terminate the worker
 */
export function terminate() {
  if (worker) {
    worker.terminate();
    worker = null;
    workerReady = false;
    readyPromise = null;
    pendingMessages.clear();
  }
}

export default {
  init,
  isReady,
  solve,
  minimize,
  maximize,
  version,
  terminate,
  Status
};
