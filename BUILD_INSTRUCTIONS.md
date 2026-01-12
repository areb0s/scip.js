# SCIP.js Build Instructions

## Prerequisites

1. **Docker Desktop** - Required for the build
   - Download: https://docs.docker.com/desktop/install/windows-install/
   - Make sure Docker Desktop is running before building

2. **WSL2** (Windows only)
   - Docker Desktop requires WSL2 on Windows
   - Enable in Windows Features or run: `wsl --install`

## Building

### Option 1: Using build.sh (Linux/macOS/WSL)

```bash
cd scip.js
chmod +x build.sh
./build.sh
```

### Option 2: Manual Docker Commands (Windows)

```powershell
# Open PowerShell in the scip.js directory

# 1. Build the Docker image (downloads SCIP, ~10 minutes first time)
docker build -t scip-wasm-builder .

# 2. Create output directory
mkdir dist

# 3. Run the build container
docker run --rm -v ${PWD}/dist:/dist scip-wasm-builder

# 4. Copy JavaScript files
copy src\*.js dist\
copy src\*.mjs dist\
copy src\*.d.ts dist\
```

### Option 3: Using Pre-built WASM (Recommended for Testing)

If you don't want to build from source, you can use the pre-built WASM from poker-chipper:

```bash
# Download pre-built SCIP WASM
curl -L -o dist/scip.wasm https://github.com/jstrieb/poker-chipper/raw/master/scip.wasm
curl -L -o dist/scip.js https://github.com/jstrieb/poker-chipper/raw/master/scip.js
```

## Build Time Expectations

| Step | Time |
|------|------|
| Docker image build (first time) | 10-15 minutes |
| SCIP compilation | 15-30 minutes |
| Total (first build) | 25-45 minutes |
| Subsequent builds | 5-10 minutes |

## Troubleshooting

### Docker Desktop Not Running

```
Error: error during connect: ... The system cannot find the file specified.
```

Solution: Start Docker Desktop and wait for it to fully initialize (check the system tray icon).

### Out of Memory

If the build fails with memory errors, increase Docker's memory allocation:
1. Docker Desktop → Settings → Resources
2. Increase Memory to at least 4GB
3. Restart Docker Desktop

### WSL2 Issues

```powershell
# Update WSL
wsl --update

# Set WSL2 as default
wsl --set-default-version 2

# Restart Docker Desktop
```

## Verifying the Build

After building, you should have these files in `dist/`:

```
dist/
├── scip.js          # Emscripten-generated JS (~50KB)
├── scip.wasm        # WebAssembly binary (~5MB)
├── scip-wrapper.js  # High-level API
├── scip-worker.js   # Web Worker
├── index.mjs        # ES Module entry
└── types.d.ts       # TypeScript definitions
```

Test the build:

```bash
# Start a local server
cd dist
python -m http.server 8080

# Open http://localhost:8080/basic.html in browser
```

## Using Without Building

For development/testing, you can mock the SCIP module. Create `dist/scip.js`:

```javascript
// Mock SCIP module for development
export default function createSCIP() {
  return Promise.resolve({
    FS: {
      writeFile: () => {},
      readFile: () => '',
      unlink: () => {},
      mkdir: () => {}
    },
    callMain: () => 0,
    onStdout: null,
    onStderr: null
  });
}
```

This allows testing the wrapper code without the actual SCIP WASM binary.
