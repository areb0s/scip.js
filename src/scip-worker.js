/**
 * SCIP.js Web Worker
 * Run SCIP in a background thread to avoid blocking the main thread
 */

import SCIP from './scip-wrapper.js';

let isInitialized = false;

/**
 * Message handler
 */
self.onmessage = async function(e) {
  const { id, type, payload } = e.data;
  
  try {
    let result;
    
    switch (type) {
      case 'init':
        await SCIP.init(payload);
        isInitialized = true;
        result = { success: true };
        break;
        
      case 'solve':
        if (!isInitialized) {
          await SCIP.init(payload.initOptions || {});
          isInitialized = true;
        }
        result = await SCIP.solve(payload.problem, payload.options);
        break;
        
      case 'minimize':
        if (!isInitialized) {
          await SCIP.init(payload.initOptions || {});
          isInitialized = true;
        }
        result = await SCIP.minimize(payload.problem, payload.options);
        break;
        
      case 'maximize':
        if (!isInitialized) {
          await SCIP.init(payload.initOptions || {});
          isInitialized = true;
        }
        result = await SCIP.maximize(payload.problem, payload.options);
        break;
        
      case 'version':
        if (!isInitialized) {
          await SCIP.init({});
          isInitialized = true;
        }
        result = await SCIP.version();
        break;
        
      case 'isReady':
        result = isInitialized;
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
    
    self.postMessage({ id, type: 'result', payload: result });
    
  } catch (error) {
    self.postMessage({ 
      id, 
      type: 'error', 
      payload: { 
        message: error.message,
        stack: error.stack 
      }
    });
  }
};

// Notify that worker is ready
self.postMessage({ type: 'ready' });
