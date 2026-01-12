# SCIP Optimization Solver -> WebAssembly Build Environment
# Uses scipoptsuite top-level build with patched CMakeLists
# Includes ZIMPL support for MINLP modeling

FROM emscripten/emsdk:3.1.56

LABEL maintainer="scip.js"
LABEL description="Build SCIP optimization solver as WebAssembly with ZIMPL support"

# Install build dependencies
# ZIMPL requires: bison, flex, gmp
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    wget \
    unzip \
    git \
    pkg-config \
    m4 \
    bison \
    flex \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# ============================================
# Build GMP for Emscripten (required by ZIMPL)
# ============================================
ENV GMP_VERSION=6.3.0

RUN wget -q https://gmplib.org/download/gmp/gmp-${GMP_VERSION}.tar.xz \
    && tar xf gmp-${GMP_VERSION}.tar.xz \
    && rm gmp-${GMP_VERSION}.tar.xz

WORKDIR /build/gmp-${GMP_VERSION}

# Configure and build GMP with Emscripten (including C++ support for SCIP)
RUN emconfigure ./configure \
        --host=none \
        --prefix=/build/gmp-install \
        --disable-shared \
        --enable-static \
        --enable-cxx \
        --disable-assembly \
    && emmake make -j$(nproc) \
    && emmake make install

# Debug: Verify GMP installation files exist
RUN echo "=== GMP Installation Contents ===" && \
    ls -la /build/gmp-install/ && \
    echo "=== Include files ===" && \
    ls -la /build/gmp-install/include/ && \
    echo "=== Library files ===" && \
    ls -la /build/gmp-install/lib/ && \
    echo "=== Checking for gmpxx.h ===" && \
    (test -f /build/gmp-install/include/gmpxx.h && echo "gmpxx.h EXISTS" || echo "gmpxx.h MISSING")

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
# ZIMPL enabled for MINLP support with GMP from our build
# Using explicit GMP paths to ensure detection (plural variable names!)
RUN emcmake cmake .. \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHARED_LIBS=OFF \
        -DZLIB=OFF \
        -DZIMPL=ON \
        -DSTATIC_GMP=ON \
        -DGMP_INCLUDE_DIRS=/build/gmp-install/include \
        -DGMP_LIBRARY=/build/gmp-install/lib/libgmp.a \
        -DGMPXX_LIBRARY=/build/gmp-install/lib/libgmpxx.a \
        -DIPOPT=OFF \
        -DPAPILO=OFF \
        -DREADLINE=OFF \
        -DBOOST=OFF \
        -DTPI=none \
        -DLPS=spx \
        -DSYM=none \
        -DCMAKE_C_FLAGS="-O3 -DNDEBUG -I/build/gmp-install/include" \
        -DCMAKE_CXX_FLAGS="-O3 -DNDEBUG -I/build/gmp-install/include" \
        -DCMAKE_EXE_LINKER_FLAGS="-O3 \
            -L/build/gmp-install/lib \
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
