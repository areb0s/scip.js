# SCIP.js

**SCIP Optimization Solver compiled to WebAssembly**

Solve Linear Programming (LP), Mixed Integer Programming (MIP), and **Mixed Integer Nonlinear Programming (MINLP)** problems directly in the browser or Node.js.

## Features

- **LP**: Linear Programming
- **MIP**: Mixed Integer Programming (binary, integer variables)
- **MINLP**: Mixed Integer Nonlinear Programming (quadratic, polynomial, nonlinear constraints)
- **ZIMPL**: Full ZIMPL modeling language support for complex problems
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

### Linear Programming (LP Format)

```javascript
import SCIP from 'scip.js';

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

### Nonlinear Programming (ZIMPL Format)

For **MINLP** and nonlinear problems, use ZIMPL format:

```javascript
import SCIP from 'scip.js';

// Quadratic optimization: minimize x² + y²
const result = await SCIP.solve(`
  var x >= 0 <= 10;
  var y >= 0 <= 10;
  
  minimize cost: x * x + y * y;
  
  subto c1: x + y >= 2;
`, { format: 'zpl' });

console.log(result.status);     // 'optimal'
console.log(result.objective);  // 2.0
console.log(result.variables);  // { x: 1, y: 1 }
```

## MINLP Examples

### Quadratic Programming

```javascript
// Portfolio optimization with risk (quadratic)
const result = await SCIP.solve(`
  set ASSETS := { "A", "B", "C" };
  
  param return[ASSETS] := <"A"> 0.12, <"B"> 0.08, <"C"> 0.15;
  param risk[ASSETS] := <"A"> 0.20, <"B"> 0.10, <"C"> 0.30;
  
  var x[ASSETS] >= 0 <= 1;
  
  maximize portfolio_return: 
    sum <a> in ASSETS: return[a] * x[a] 
    - 0.5 * sum <a> in ASSETS: risk[a] * x[a] * x[a];
  
  subto budget: sum <a> in ASSETS: x[a] == 1;
`, { format: 'zpl' });
```

### Mixed Integer Nonlinear (MINLP)

```javascript
// Facility location with economies of scale
const result = await SCIP.solve(`
  set FACILITIES := { 1 to 5 };
  set CUSTOMERS := { 1 to 10 };
  
  param demand[CUSTOMERS] := <1> 10, <2> 15, <3> 20, <4> 12, <5> 18,
                             <6> 8, <7> 25, <8> 14, <9> 16, <10> 11;
  
  var open[FACILITIES] binary;           # 1 if facility is open
  var flow[FACILITIES * CUSTOMERS] >= 0; # amount shipped
  var capacity[FACILITIES] >= 0 <= 100;  # facility capacity
  
  minimize total_cost:
    sum <f> in FACILITIES: 1000 * open[f]                    # fixed cost
    + sum <f> in FACILITIES: 50 * sqrt(capacity[f])          # capacity cost (nonlinear)
    + sum <f,c> in FACILITIES * CUSTOMERS: 2 * flow[f,c];    # transport cost
  
  subto satisfy_demand: 
    forall <c> in CUSTOMERS:
      sum <f> in FACILITIES: flow[f,c] >= demand[c];
  
  subto capacity_limit:
    forall <f> in FACILITIES:
      sum <c> in CUSTOMERS: flow[f,c] <= capacity[f] * open[f];
`, { format: 'zpl' });
```

### Polynomial Constraints

```javascript
// Nonlinear constraints with polynomials
const result = await SCIP.solve(`
  var x >= -10 <= 10;
  var y >= -10 <= 10;
  
  minimize obj: x + y;
  
  # Polynomial constraint: x³ + y³ >= 8
  subto poly: x * x * x + y * y * y >= 8;
  
  # Circle constraint: x² + y² <= 25
  subto circle: x * x + y * y <= 25;
`, { format: 'zpl' });
```

## API Reference

### `SCIP.solve(problem, options?)`

Solve an optimization problem.

**Parameters:**
- `problem` (string): Problem definition
- `options` (object, optional):
  - `format`: `'lp'` | `'mps'` | `'zpl'` | `'cip'` (default: `'lp'`)
    - `'lp'`: LP format (linear problems only)
    - `'mps'`: MPS format (linear problems only)
    - `'zpl'`: **ZIMPL format (supports MINLP, nonlinear)**
    - `'cip'`: CIP format (SCIP's native format)
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

## Format Reference

### LP Format (Linear Only)

```
\ Comments start with backslash
Minimize (or Maximize)
  obj: 2 x + 3 y - z

Subject To
  constraint1: x + y >= 10
  constraint2: x - y <= 5

Bounds
  0 <= x <= 100
  y >= 0

General (Integer variables)
  x

Binary (0-1 variables)
  y

End
```

### ZIMPL Format (Supports Nonlinear)

```zimpl
# Sets
set ITEMS := { "apple", "banana", "orange" };

# Parameters
param weight[ITEMS] := <"apple"> 2, <"banana"> 3, <"orange"> 4;
param value[ITEMS] := <"apple"> 10, <"banana"> 15, <"orange"> 20;

# Variables
var x[ITEMS] binary;          # binary variable
var y >= 0 <= 100;            # continuous variable
var z integer >= 0 <= 10;     # integer variable

# Objective (can include nonlinear terms)
maximize profit: 
  sum <i> in ITEMS: value[i] * x[i] 
  - 0.1 * y * y;              # quadratic term

# Constraints
subto capacity: 
  sum <i> in ITEMS: weight[i] * x[i] <= 10;

subto nonlinear_constraint:
  y * y + z * z <= 50;        # quadratic constraint
```

## More Examples

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

### With Time Limit and Gap

```javascript
const result = await SCIP.solve(problem, {
  format: 'zpl',
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

// Solve MINLP in background
const result = await solver.solve(nonlinearProblem, { 
  format: 'zpl',
  timeLimit: 300 
});

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
git clone https://github.com/areb0s/scip.js
cd scip.js

# Build WASM (uses Docker, includes ZIMPL + GMP)
./build.sh

# Output in dist/
ls dist/
# scip.js  scip.wasm  index.mjs  types.d.ts
```

The build process:
1. Downloads and compiles GMP (for ZIMPL support)
2. Downloads SCIP Optimization Suite with ZIMPL
3. Compiles with Emscripten to WebAssembly
4. Bundles JavaScript wrapper

## File Sizes

| File | Size | Gzipped |
|------|------|---------|
| scip.wasm | ~8 MB | ~2.5 MB |
| scip.js | ~60 KB | ~18 KB |

## Limitations

- **Single-threaded**: WASM runs single-threaded (use Web Workers for parallelism at application level)
- **Memory**: Limited to ~2GB (WASM 32-bit limit)
- **No callbacks**: Progress callbacks not yet supported

## Performance

Typical solving times in browser (varies by problem complexity):

| Problem Type | Variables | Constraints | Time |
|--------------|-----------|-------------|------|
| LP | 1,000 | 500 | <1s |
| LP | 10,000 | 5,000 | ~5s |
| MIP | 100 binary | 50 | ~1s |
| MIP | 1,000 binary | 500 | ~30s |
| MINLP (quadratic) | 50 | 20 | ~2s |
| MINLP (polynomial) | 100 | 50 | ~10s |

## License

Apache 2.0 (same as SCIP)

## Credits

- [SCIP Optimization Suite](https://scipopt.org) - The underlying solver
- [ZIMPL](https://zimpl.zib.de/) - Modeling language for MINLP
- [Emscripten](https://emscripten.org) - C++ to WebAssembly compiler

## Links

- [SCIP Documentation](https://scipopt.org/doc/html/)
- [ZIMPL User Guide](https://zimpl.zib.de/download/zimpl.pdf)
- [LP Format Reference](https://www.gurobi.com/documentation/current/refman/lp_format.html)
