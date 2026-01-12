#!/bin/bash
# SCIP.js Build Script
# Builds SCIP optimization solver as WebAssembly using Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="${SCRIPT_DIR}/build"
DIST_DIR="${SCRIPT_DIR}/dist"

echo "=========================================="
echo "  SCIP.js WebAssembly Build"
echo "=========================================="
echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required but not installed."
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Create directories
mkdir -p "${BUILD_DIR}"
mkdir -p "${DIST_DIR}"

echo "[1/5] Building Docker image (this downloads SCIP ~100MB)..."
echo "      This step takes 5-10 minutes on first run."
echo ""
docker build -t scip-wasm-builder "${SCRIPT_DIR}"

echo ""
echo "[2/5] Running WASM compilation..."
echo "      This step takes 15-30 minutes."
echo ""
docker run --rm \
    -v "${DIST_DIR}:/dist" \
    scip-wasm-builder

echo ""
echo "[3/5] Verifying WASM output..."
if [ -f "${DIST_DIR}/scip.wasm" ]; then
    echo "      scip.wasm found!"
    ls -lh "${DIST_DIR}/scip.wasm"
else
    echo "      ERROR: scip.wasm not found!"
    echo "      Check build.log for errors:"
    cat "${DIST_DIR}/build.log" 2>/dev/null | tail -50 || echo "No build log found"
    exit 1
fi

echo ""
echo "[4/5] Copying JavaScript wrapper files..."
cp "${SCRIPT_DIR}/src/scip-wrapper.js" "${DIST_DIR}/"
cp "${SCRIPT_DIR}/src/scip-worker.js" "${DIST_DIR}/"
cp "${SCRIPT_DIR}/src/scip-worker-client.js" "${DIST_DIR}/"
cp "${SCRIPT_DIR}/src/index.mjs" "${DIST_DIR}/"
cp "${SCRIPT_DIR}/src/types.d.ts" "${DIST_DIR}/"
cp "${SCRIPT_DIR}/src/pre.js" "${DIST_DIR}/"

# Create a simple post-process wrapper that adds pre.js content
if [ -f "${DIST_DIR}/scip.js" ]; then
    echo ""
    echo "[5/5] Post-processing scip.js..."
    # Prepend module initialization helpers
    cat > "${DIST_DIR}/scip-module.js" << 'EOF'
// SCIP.js Module Wrapper
// Auto-generated - do not edit

var Module = typeof Module !== 'undefined' ? Module : {};

// Pre-initialization
Module['preRun'] = Module['preRun'] || [];
Module['postRun'] = Module['postRun'] || [];

Module['preRun'].push(function() {
    if (typeof FS !== 'undefined') {
        try { FS.mkdir('/problems'); } catch(e) {}
        try { FS.mkdir('/solutions'); } catch(e) {}
        try { FS.mkdir('/settings'); } catch(e) {}
    }
});

Module['print'] = function(text) {
    if (Module['onStdout']) Module['onStdout'](text);
    else console.log('[SCIP]', text);
};

Module['printErr'] = function(text) {
    if (Module['onStderr']) Module['onStderr'](text);
    else console.error('[SCIP]', text);
};

EOF
    cat "${DIST_DIR}/scip.js" >> "${DIST_DIR}/scip-module.js"
    mv "${DIST_DIR}/scip-module.js" "${DIST_DIR}/scip.js"
fi

echo ""
echo "=========================================="
echo "  Build Complete!"
echo "=========================================="
echo ""
echo "Output files in ${DIST_DIR}:"
ls -lh "${DIST_DIR}"

echo ""
echo "File sizes:"
echo "  scip.wasm: $(ls -lh "${DIST_DIR}/scip.wasm" 2>/dev/null | awk '{print $5}' || echo 'N/A')"
echo "  scip.js:   $(ls -lh "${DIST_DIR}/scip.js" 2>/dev/null | awk '{print $5}' || echo 'N/A')"

if [ -f "${DIST_DIR}/scip.wasm" ]; then
    WASM_SIZE=$(stat -f%z "${DIST_DIR}/scip.wasm" 2>/dev/null || stat -c%s "${DIST_DIR}/scip.wasm" 2>/dev/null || echo "0")
    WASM_SIZE_MB=$(echo "scale=2; $WASM_SIZE / 1048576" | bc 2>/dev/null || echo "?")
    echo "  scip.wasm: ${WASM_SIZE_MB} MB"
fi

echo ""
echo "To test locally:"
echo "  cd ${DIST_DIR}"
echo "  python3 -m http.server 8080"
echo "  # Open http://localhost:8080/basic.html"
echo ""
echo "To run Node.js tests:"
echo "  node examples/test.mjs"
