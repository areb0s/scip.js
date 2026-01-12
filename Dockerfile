# SCIP Optimization Solver -> WebAssembly Build Environment
# Uses scipoptsuite top-level build with patched CMakeLists

FROM emscripten/emsdk:3.1.56

LABEL maintainer="scip.js"
LABEL description="Build SCIP optimization solver as WebAssembly"

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    wget \
    unzip \
    git \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# SCIP Optimization Suite version
ENV SCIP_VERSION=8.1.0

# Download SCIP Optimization Suite
RUN wget -q https://scipopt.org/download/release/scipoptsuite-${SCIP_VERSION}.tgz \
    && tar xzf scipoptsuite-${SCIP_VERSION}.tgz \
    && rm scipoptsuite-${SCIP_VERSION}.tgz

# Remove examples and applications directories to avoid build issues
RUN rm -rf /build/scipoptsuite-${SCIP_VERSION}/scip/examples \
    && rm -rf /build/scipoptsuite-${SCIP_VERSION}/scip/applications

# Patch SCIP CMakeLists.txt to skip examples and applications
RUN sed -i 's/add_subdirectory(examples)/# add_subdirectory(examples)/g' /build/scipoptsuite-${SCIP_VERSION}/scip/CMakeLists.txt \
    && sed -i 's/add_subdirectory(applications)/# add_subdirectory(applications)/g' /build/scipoptsuite-${SCIP_VERSION}/scip/CMakeLists.txt

# Build from top-level scipoptsuite directory
WORKDIR /build/scipoptsuite-${SCIP_VERSION}
RUN mkdir build-wasm

WORKDIR /build/scipoptsuite-${SCIP_VERSION}/build-wasm

# Configure using top-level CMakeLists.txt
RUN emcmake cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DZLIB=OFF \
        -DZIMPL=OFF \
        -DIPOPT=OFF \
        -DPAPILO=OFF \
        -DGMP=OFF \
        -DREADLINE=OFF \
        -DBOOST=OFF \
        -DTPI=none \
        -DLPS=spx \
        -DSYM=none \
        -DCMAKE_C_FLAGS="-O3 -DNDEBUG" \
        -DCMAKE_CXX_FLAGS="-O3 -DNDEBUG" \
        -DCMAKE_EXE_LINKER_FLAGS="-O3 \
            -s MODULARIZE=1 \
            -s EXPORT_NAME=createSCIP \
            -s EXPORT_ES6=1 \
            -s EXPORTED_RUNTIME_METHODS=FS,callMain \
            -s EXPORTED_FUNCTIONS=_main \
            -s ALLOW_MEMORY_GROWTH=1 \
            -s INITIAL_MEMORY=268435456 \
            -s MAXIMUM_MEMORY=2147483648 \
            -s STACK_SIZE=5242880 \
            -s ENVIRONMENT=web,worker \
            -s FILESYSTEM=1 \
            -s FORCE_FILESYSTEM=1 \
            -s EXIT_RUNTIME=0 \
            -s INVOKE_RUN=0 \
            -s NO_EXIT_RUNTIME=1"

# Build only the scip target
RUN emmake make -j$(nproc) scip 2>&1 | tee /build/build.log

# Create output directory and copy artifacts
RUN mkdir -p /output && \
    find /build -name "scip.js" -type f -exec cp {} /output/ \; 2>/dev/null || true && \
    find /build -name "scip.wasm" -type f -exec cp {} /output/ \; 2>/dev/null || true && \
    find /build -path "*/bin/scip" -type f ! -name "*.cpp" ! -name "*.h" -exec sh -c 'file {} | grep -q "JavaScript" && cp {} /output/scip.js' \; 2>/dev/null || true && \
    cp /build/build.log /output/ 2>/dev/null || true && \
    ls -la /output/

WORKDIR /output

CMD ["sh", "-c", "cp -r /output/* /dist/ 2>/dev/null; echo 'Output files:'; ls -la /output/"]
