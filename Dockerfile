# SCIP Optimization Solver -> WebAssembly Build Environment
# Uses scipoptsuite top-level build with patched CMakeLists
# Includes ZIMPL support for MINLP modeling
# Includes JavaScript callback support via C API wrapper

FROM emscripten/emsdk:3.1.56

LABEL maintainer="scip.js"
LABEL description="Build SCIP optimization solver as WebAssembly with ZIMPL and callback support"

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

# Copy custom C API wrapper
COPY src/scip_api.c /build/scip_api.c

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
        -DSCIP_WITH_ZIMPL=ON \
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
        -DCMAKE_C_FLAGS="-O3 -DNDEBUG -I/build/gmp-install/include -fexceptions" \
        -DCMAKE_CXX_FLAGS="-O3 -DNDEBUG -I/build/gmp-install/include -fexceptions" \
        -DCMAKE_EXE_LINKER_FLAGS="-O3 \
            -L/build/gmp-install/lib \
            -fexceptions \
            -s MODULARIZE=1 \
            -s EXPORT_NAME=createSCIP \
            -s EXPORT_ES6=1 \
            -s EXPORTED_RUNTIME_METHODS=FS,callMain,getExceptionMessage,incrementExceptionRefcount,decrementExceptionRefcount \
            -s EXPORTED_FUNCTIONS=_main \
            -s ALLOW_MEMORY_GROWTH=1 \
            -s INITIAL_MEMORY=268435456 \
            -s MAXIMUM_MEMORY=2147483648 \
            -s STACK_SIZE=16777216 \
            -s ENVIRONMENT=web,worker \
            -s FILESYSTEM=1 \
            -s FORCE_FILESYSTEM=1 \
            -s EXIT_RUNTIME=0 \
            -s INVOKE_RUN=0 \
            -s NO_EXIT_RUNTIME=1 \
            -s DISABLE_EXCEPTION_CATCHING=0 \
            -s EXCEPTION_CATCHING_ALLOWED=all"

# Build SCIP library (both CLI and static library)
RUN emmake make -j$(nproc) libscip scip 2>&1 | tee /build/build.log

# ============================================
# Build custom SCIP API wrapper with callbacks
# ============================================
WORKDIR /build

# Find SCIP include and library paths
RUN echo "=== Finding SCIP paths ===" && \
    find /build -name "scip.h" -type f 2>/dev/null | head -5 && \
    find /build -name "libscip*.a" -type f 2>/dev/null | head -5

# Compile scip_api.c as a standalone WASM module with SCIP API
RUN SCIP_INC=$(find /build/scipoptsuite-*/scip/src -name "scip" -type d | head -1 | sed 's|/scip$||') && \
    SCIP_BUILD_INC="/build/scipoptsuite-${SCIP_VERSION}/build-wasm/scip" && \
    SCIP_LIB=$(find /build -name "libscip.a" -type f | head -1) && \
    SOPLEX_LIB=$(find /build -name "libsoplex*.a" -type f | head -1) && \
    ZIMPL_LIB=$(find /build -name "libzimpl*.a" -type f | head -1 || echo "") && \
    echo "SCIP_INC: $SCIP_INC" && \
    echo "SCIP_BUILD_INC: $SCIP_BUILD_INC" && \
    echo "SCIP_LIB: $SCIP_LIB" && \
    echo "SOPLEX_LIB: $SOPLEX_LIB" && \
    echo "ZIMPL_LIB: $ZIMPL_LIB" && \
    rm -f /build/scip-api.js /build/scip-api.wasm /build/api-build.log && \
    emcc -O3 \
        -I"$SCIP_INC" \
        -I"$SCIP_BUILD_INC" \
        -I/build/gmp-install/include \
        /build/scip_api.c \
        "$SCIP_LIB" \
        "$SOPLEX_LIB" \
        ${ZIMPL_LIB:+"$ZIMPL_LIB"} \
        /build/gmp-install/lib/libgmp.a \
        /build/gmp-install/lib/libgmpxx.a \
        -o /build/scip-api.js \
        -s MODULARIZE=1 \
        -s EXPORT_NAME=createSCIPAPI \
        -s EXPORT_ES6=1 \
        -s EXPORTED_FUNCTIONS="[ \
            '_scip_create', \
            '_scip_free', \
            '_scip_read_problem', \
            '_scip_set_time_limit', \
            '_scip_set_gap', \
            '_scip_set_param_int', \
            '_scip_set_param_real', \
            '_scip_set_param_bool', \
            '_scip_set_param_string', \
            '_scip_add_solution_hint', \
            '_scip_set_cutoff', \
            '_scip_solve', \
            '_scip_get_objective', \
            '_scip_get_var_value', \
            '_scip_get_nvars', \
            '_scip_get_var_names', \
            '_scip_ctx_get_var_lp_value', \
            '_scip_ctx_get_var_redcost', \
            '_scip_get_solving_time', \
            '_scip_get_nnodes', \
            '_scip_get_gap', \
            '_scip_get_dual_bound', \
             '_scip_get_primal_bound', \
             '_scip_reset', \
             '_scip_problem_clear', \
             '_scip_problem_begin', \
             '_scip_add_cons_linear', \
             '_scip_set_cons_modifiable', \
             '_scip_add_var', \
             '_scip_add_coef_linear', \
             '_scip_add_coef_linear_batch', \
             '_scip_enable_incumbent_callback', \
             '_scip_enable_node_callback', \
            '_scip_ctx_get_stage', \
            '_scip_ctx_has_lp', \
            '_scip_ctx_get_lp_solstat', \
            '_scip_ctx_get_pricing_mode', \
            '_scip_ctx_is_transformed', \
            '_scip_var_find_id', \
            '_scip_cons_find_id', \
            '_scip_var_get_transformed', \
            '_scip_cons_get_transformed', \
            '_scip_cons_get_row', \
            '_scip_cons_is_in_lp', \
            '_scip_cons_get_dual_linear', \
            '_scip_cons_get_farkas_linear', \
            '_scip_row_get_dual', \
            '_scip_row_get_farkas', \
            '_scip_row_get_lhs', \
            '_scip_row_get_rhs', \
            '_scip_row_get_lppos', \
            '_scip_row_is_in_lp', \
            '_scip_row_is_local', \
            '_scip_row_get_name', \
            '_scip_ctx_get_n_lp_rows', \
            '_scip_ctx_get_lp_row_duals_batch', \
            '_scip_ctx_get_lp_row_farkas_batch', \
            '_scip_pricer_add_var_to_rows_batch', \
            '_scip_pricer_add_var_to_conss_batch', \
            '_scip_pricer_add_priced_var', \
            '_scip_pricer_get_n_added_vars', \
            '_scip_pricer_include', \
            '_scip_pricer_activate', \
            '_scip_pricer_deactivate', \
            '_scip_pricer_is_active', \
            '_scip_pricer_enable_redcost_callback', \
            '_scip_pricer_enable_farkas_callback', \
            '_scip_pricer_set_result', \
            '_scip_pricer_set_lowerbound', \
            '_scip_pricer_set_stopearly', \
            '_scip_pricer_abort_round', \
            '_scip_pricer_get_n_added_vars_this_call', \
            '_scip_pricer_get_last_result', \
            '_scip_pricer_get_last_mode', \
            '_scip_pricer_get_redcost_calls', \
            '_scip_pricer_get_farkas_calls', \
            '_scip_pricer_get_round', \
            '_scip_result_success', \
            '_scip_result_didnotrun', \
            '_scip_result_didnotfind', \
            '_scip_model_write_lp', \
            '_scip_model_write_lp_snapshot', \
            '_scip_model_write_mip', \
            '_malloc', \
            '_free' \
        ]" \
        -s EXPORT_KEEPALIVE=1 \
        -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','UTF8ToString','stringToUTF8','FS','allocateUTF8']" \
        -s ALLOW_MEMORY_GROWTH=1 \
        -s INITIAL_MEMORY=268435456 \
        -s MAXIMUM_MEMORY=2147483648 \
        -s STACK_SIZE=16777216 \
        -s ENVIRONMENT=web,worker \
        -s FILESYSTEM=1 \
        -s FORCE_FILESYSTEM=1 \
        -s EXIT_RUNTIME=0 \
        -s NO_EXIT_RUNTIME=1 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -lembind \
        > /build/api-build.log 2>&1 && cat /build/api-build.log

# Create output directory and copy artifacts
RUN mkdir -p /output && \
    find /build -name "scip.js" -type f -exec cp {} /output/ \; 2>/dev/null || true && \
    find /build -name "scip.wasm" -type f -exec cp {} /output/ \; 2>/dev/null || true && \
    find /build -path "*/bin/scip" -type f ! -name "*.cpp" ! -name "*.h" -exec sh -c 'file {} | grep -q "JavaScript" && cp {} /output/scip.js' \; 2>/dev/null || true && \
    cp /build/scip-api.js /output/ 2>/dev/null || true && \
    cp /build/scip-api.wasm /output/ 2>/dev/null || true && \
    cp /build/build.log /output/ 2>/dev/null || true && \
    cp /build/api-build.log /output/ 2>/dev/null || true && \
    ls -la /output/

WORKDIR /output

CMD ["sh", "-c", "cp -r /output/* /dist/ 2>/dev/null; echo 'Output files:'; ls -la /output/"]
