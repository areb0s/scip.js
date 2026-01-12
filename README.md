# SCIP.js

**SCIP Optimization Solver compiled to WebAssembly**

Solve Linear Programming (LP), Mixed Integer Programming (MIP), and Mixed Integer Nonlinear Programming (MINLP) problems directly in the browser or Node.js.

## Features

- **LP**: Linear Programming
- **MIP**: Mixed Integer Programming (binary, integer variables)
- **MINLP**: Mixed Integer Nonlinear Programming
- **Zero Dependencies**: Pure WebAssembly, no native bindings
- **Browser & Node.js**: Works everywhere JavaScript runs
- **Web Worker Support**: Non-blocking solver for long computations
- **TypeScript**: Full type definitions included

## Installation

```bash
npm install scip.js
```

Or use via CDN:

```html
<script type="module">
  import SCIP from 'https://unpkg.com/scip.js/dist/index.mjs';
</script>
```

## Quick Start

```javascript
import SCIP from 'scip.js';

// Solve a linear programming problem
const result = await SCIP.solve(`
  Minimize
    obj: 2 x + 3 y
  Subject To
    c1: x + y >= 4
    c2: 2 x + y >= 5
  Bounds
    x >= 0
    y >= 0
  End
`);

console.log(result.status);     // 'optimal'
console.log(result.objective);  // 7.0
console.log(result.variables);  // { x: 1, y: 3 }
```

## API Reference

### `SCIP.solve(problem, options?)`

Solve an optimization problem.

**Parameters:**
- `problem` (string): Problem in LP format
- `options` (object, optional):
  - `format`: `'lp'` | `'mps'` | `'zpl'` (default: `'lp'`)
  - `timeLimit`: Time limit in seconds (default: 3600)
  - `gap`: Relative MIP gap tolerance (e.g., 0.01 for 1%)
  - `verbose`: Enable verbose output (default: false)
  - `parameters`: Additional SCIP parameters

**Returns:** `Promise<Solution>`

```typescript
interface Solution {
  status: 'optimal' | 'infeasible' | 'unbounded' | 'timelimit' | 'unknown' | 'error';
  objective: number | null;
  variables: Record<string, number>;
  statistics: {
    solvingTime: number | null;
    nodes: number | null;
    iterations: number | null;
    gap: number | null;
  };
}
```

### `SCIP.minimize(problem, options?)`

Convenience wrapper that ensures the problem is minimized.

### `SCIP.maximize(problem, options?)`

Convenience wrapper that ensures the problem is maximized.

### `SCIP.init(options?)`

Initialize the SCIP WASM module. Called automatically on first solve.

### `SCIP.version()`

Get SCIP version information.

## LP Format Reference

The LP format is a human-readable format for optimization problems:

```
\ Comments start with backslash
Minimize (or Maximize)
  obj: 2 x + 3 y - z

Subject To
  constraint1: x + y >= 10
  constraint2: x - y <= 5
  constraint3: x + 2 y + 3 z = 15

Bounds
  0 <= x <= 100
  y >= 0
  z free

General (Integer variables)
  x

Binary (0-1 variables)
  y

End
```

## Examples

### Linear Programming

```javascript
const result = await SCIP.minimize(`
  obj: 100 x1 + 150 x2
  Subject To
    labor: 2 x1 + 3 x2 <= 120
    materials: 4 x1 + 2 x2 <= 100
  Bounds
    x1 >= 0
    x2 >= 0
  End
`);
```

### Mixed Integer Programming (Knapsack)

```javascript
const result = await SCIP.maximize(`
  obj: 60 item1 + 100 item2 + 120 item3
  Subject To
    weight: 10 item1 + 20 item2 + 30 item3 <= 50
  Binary
    item1 item2 item3
  End
`);

// result.variables = { item2: 1, item3: 1 }
// result.objective = 220
```

### Transportation Problem

```javascript
const result = await SCIP.minimize(`
  obj: 8 x11 + 6 x12 + 10 x13 + 9 x21 + 12 x22 + 7 x23
  Subject To
    supply1: x11 + x12 + x13 <= 100
    supply2: x21 + x22 + x23 <= 150
    demand1: x11 + x21 >= 80
    demand2: x12 + x22 >= 70
    demand3: x13 + x23 >= 60
  Bounds
    x11 >= 0
    x12 >= 0
    x13 >= 0
    x21 >= 0
    x22 >= 0
    x23 >= 0
  End
`);
```

### With Time Limit and Gap

```javascript
const result = await SCIP.solve(problem, {
  timeLimit: 60,  // 60 seconds
  gap: 0.01,      // Stop when within 1% of optimal
  verbose: true   // Print solver output
});
```

## Web Worker Usage

For long-running optimizations, use the Web Worker API to avoid blocking the main thread:

```javascript
import { createWorkerSolver } from 'scip.js';

const solver = await createWorkerSolver();

// Solve in background
const result = await solver.solve(largeProblem, { timeLimit: 300 });

// Clean up when done
solver.terminate();
```

## Building from Source

### Prerequisites

- Docker
- Bash

### Build

```bash
# Clone repository
git clone https://github.com/user/scip.js
cd scip.js

# Build WASM (uses Docker)
./build.sh

# Output in dist/
ls dist/
# scip.js  scip.wasm  index.mjs  types.d.ts
```

The build process:
1. Downloads SCIP Optimization Suite
2. Compiles with Emscripten to WebAssembly
3. Bundles JavaScript wrapper

## File Sizes

| File | Size | Gzipped |
|------|------|---------|
| scip.wasm | ~5 MB | ~1.5 MB |
| scip.js | ~50 KB | ~15 KB |

## Limitations

- **Single-threaded**: WASM runs single-threaded (use Web Workers for parallelism at application level)
- **Memory**: Limited to ~2GB (WASM 32-bit limit)
- **No callbacks**: Progress callbacks not yet supported
- **ZIMPL disabled**: ZIMPL modeling language not included (use LP/MPS format)

## Performance

Typical solving times in browser (varies by problem complexity):

| Problem Type | Variables | Constraints | Time |
|--------------|-----------|-------------|------|
| LP | 1,000 | 500 | <1s |
| LP | 10,000 | 5,000 | ~5s |
| MIP | 100 binary | 50 | ~1s |
| MIP | 1,000 binary | 500 | ~30s |

## License

Apache 2.0 (same as SCIP)

## Credits

- [SCIP Optimization Suite](https://scipopt.org) - The underlying solver
- [Emscripten](https://emscripten.org) - C++ to WebAssembly compiler
- [poker-chipper](https://github.com/jstrieb/poker-chipper) - Reference SCIP WASM build

## Links

- [SCIP Documentation](https://scipopt.org/doc/html/)
- [LP Format Reference](https://www.gurobi.com/documentation/current/refman/lp_format.html)
- [MPS Format Reference](https://www.gurobi.com/documentation/current/refman/mps_format.html)
