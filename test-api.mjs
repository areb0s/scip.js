/**
 * Test SCIP Callback API
 */
// Import directly from the API wrapper to avoid broken scip-wrapper.js
import { SCIPApi } from './dist/scip-api-wrapper.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WASM_PATH = resolve(__dirname, 'dist', 'scip-api.wasm');

// Helper function to create solver (same as createCallbackSolver)
async function createCallbackSolver(options = {}) {
  console.log('  WASM_PATH:', WASM_PATH);
  const solver = new SCIPApi();
  await solver.init({ wasmPath: WASM_PATH, ...options });
  return solver;
}

// Simple LP problem
const lpProblem = `
Minimize obj: x + 2 y
Subject To
  c1: x + y >= 1
Bounds
  0 <= x <= 10
  0 <= y <= 10
End
`;

// MIP problem (to test incumbent callbacks)
const mipProblem = `
Maximize obj: 5 x1 + 8 x2 + 6 x3 + 9 x4
Subject To
  c1: 2 x1 + 3 x2 + 4 x3 + 5 x4 <= 10
  c2: 3 x1 + 2 x2 + 3 x3 + 2 x4 <= 8
Bounds
  0 <= x1 <= 1
  0 <= x2 <= 1
  0 <= x3 <= 1
  0 <= x4 <= 1
General
  x1 x2 x3 x4
End
`;

async function testLPProblem() {
  console.log('=== Testing LP Problem ===');
  
  const solver = await createCallbackSolver();
  
  // Set incumbent callback
  let incumbentCount = 0;
  solver.onIncumbent((objValue) => {
    incumbentCount++;
    console.log(`  Incumbent #${incumbentCount}: objective = ${objValue}`);
  });
  
  const result = await solver.solve(lpProblem, {
    format: 'lp',
    timeLimit: 60
  });
  
  console.log('Status:', result.status);
  console.log('Objective:', result.objective);
  console.log('Variables:', result.variables);
  console.log('Incumbent callbacks received:', incumbentCount);
  
  solver.destroy();
  return result.status === 'optimal';
}

async function testMIPProblem() {
  console.log('\n=== Testing MIP Problem ===');
  
  const solver = await createCallbackSolver();
  
  // Set incumbent callback
  const incumbents = [];
  solver.onIncumbent((objValue) => {
    incumbents.push(objValue);
    console.log(`  New incumbent found: ${objValue}`);
  });
  
  // Set node callback (for progress)
  let lastNodes = 0;
  solver.onNode((data) => {
    if (data.nodes > lastNodes + 10) {
      console.log(`  Progress: ${data.nodes} nodes, dual=${data.dualBound.toFixed(2)}, primal=${data.primalBound.toFixed(2)}`);
      lastNodes = data.nodes;
    }
  });
  
  const result = await solver.solve(mipProblem, {
    format: 'lp',
    timeLimit: 60
  });
  
  console.log('Status:', result.status);
  console.log('Objective:', result.objective);
  console.log('Variables:', result.variables);
  console.log('Incumbents found:', incumbents.length);
  console.log('Statistics:', result.statistics);
  
  solver.destroy();
  return result.status === 'optimal';
}

async function testInitialSolution() {
  console.log('\n=== Testing Initial Solution (Warm Start) ===');
  
  const solver = await createCallbackSolver();
  
  // Provide an initial solution
  const result = await solver.solve(mipProblem, {
    format: 'lp',
    timeLimit: 60,
    initialSolution: {
      x1: 1,
      x2: 0,
      x3: 1,
      x4: 0
    }
  });
  
  console.log('Status:', result.status);
  console.log('Objective:', result.objective);
  console.log('Nodes explored:', result.statistics.nodes);
  
  solver.destroy();
  return result.status === 'optimal';
}


async function testCutoff() {
  console.log('\n=== Testing Cutoff Bound ===');
  
  const solver = await createCallbackSolver();
  
  // Set cutoff - for maximization, this prunes solutions worse than this value
  const result = await solver.solve(mipProblem, {
    format: 'lp',
    timeLimit: 60,
    cutoff: 20  // Only accept solutions with obj >= 20
  });
  
  console.log('Status:', result.status);
  console.log('Objective:', result.objective);
  
  solver.destroy();
  return true;
}

async function main() {
  try {
    console.log('SCIP Callback API Test\n');
    
    const tests = [
      testLPProblem,
      testMIPProblem,
      testInitialSolution,
      testCutoff
    ];
    
    let passed = 0;
    for (const test of tests) {
      try {
        if (await test()) {
          passed++;
        }
      } catch (error) {
        console.error(`Test failed with error: ${error.message}`);
        console.error(error.stack);
      }
    }
    
    console.log(`\n=== Results: ${passed}/${tests.length} tests passed ===`);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
