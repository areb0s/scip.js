/**
 * SCIP.js API Mode - Bundled IIFE Version
 * 
 * For use with new Function() in web workers:
 *   new Function(scriptText)();
 *   const solver = new self.SCIPApi();
 *   await solver.init({ wasmPath: '...' });
 */
(function(global) {
  "use strict";

  const DEFAULT_CDN_BASE = "https://cdn.jsdelivr.net/npm/@areb0s/scip.js@latest/dist/";

  const Status = {
    OPTIMAL: "optimal",
    INFEASIBLE: "infeasible",
    UNBOUNDED: "unbounded",
    TIME_LIMIT: "timelimit",
    UNKNOWN: "unknown",
    ERROR: "error",
  };

  function getBaseUrl() {
    if (global.SCIP_BASE_URL) {
      return global.SCIP_BASE_URL;
    }
    return DEFAULT_CDN_BASE;
  }

  class SCIPApi {
    constructor() {
      this._module = null;
      this._incumbentCallback = null;
      this._nodeCallback = null;
      this._pricerRedcostCallback = null;
      this._pricerFarkasCallback = null;
      this._isInitialized = false;
    }

    async init(options = {}) {
      if (this._isInitialized) {
        return;
      }

      const baseUrl = options.baseUrl || getBaseUrl();
      const wasmPath = options.wasmPath || baseUrl + "scip-api.wasm";
      const jsPath = options.jsPath || baseUrl + "scip-api.js";

      // Fetch and load scip-api.js dynamically
      const response = await fetch(jsPath);
      if (!response.ok) {
        throw new Error(`Failed to load scip-api.js: ${response.status}`);
      }
      const jsText = await response.text();
      
      // Create module factory from fetched code
      // scip-api.js exports createSCIPAPI as default
      let createSCIPAPI;
      const moduleExports = {};
      const moduleFunc = new Function('exports', jsText + '\nexports.default = createSCIPAPI;');
      moduleFunc(moduleExports);
      createSCIPAPI = moduleExports.default;

      if (!createSCIPAPI) {
        throw new Error("Failed to load SCIP API module");
      }

      // Initialize Emscripten module
      this._module = await createSCIPAPI({
        locateFile: (path) => {
          if (path.endsWith(".wasm")) {
            return wasmPath;
          }
          return baseUrl + path;
        }
      });

      // Create SCIP instance
      const created = this._module._scip_create();
      if (!created) {
        throw new Error("Failed to create SCIP instance");
      }

      // Setup callbacks
      this._module.onIncumbent = (objValue) => {
        if (this._incumbentCallback) {
          this._incumbentCallback(objValue);
        }
      };

      this._module.onNode = (dualBound, primalBound, nodes) => {
        if (this._nodeCallback) {
          this._nodeCallback({ dualBound, primalBound, nodes });
        }
      };

      this._module.onPricerRedcost = () => {
        if (this._pricerRedcostCallback) {
          this._pricerRedcostCallback();
        }
      };

      this._module.onPricerFarkas = () => {
        if (this._pricerFarkasCallback) {
          this._pricerFarkasCallback();
        }
      };

      // Create virtual filesystem directories
      try { this._module.FS.mkdir("/problems"); } catch (e) { /* exists */ }
      try { this._module.FS.mkdir("/solutions"); } catch (e) { /* exists */ }

      this._isInitialized = true;
    }

    onIncumbent(callback) {
      this._incumbentCallback = callback;
      if (this._module) {
        this._module._scip_enable_incumbent_callback(callback ? 1 : 0);
      }
    }

    onNode(callback) {
      this._nodeCallback = callback;
      if (this._module) {
        this._module._scip_enable_node_callback(callback ? 1 : 0);
      }
    }

    onPricerRedcost(callback) {
      this._pricerRedcostCallback = callback;
      if (this._module) {
        this._module._scip_pricer_enable_redcost_callback(callback ? 1 : 0);
      }
    }

    onPricerFarkas(callback) {
      this._pricerFarkasCallback = callback;
      if (this._module) {
        this._module._scip_pricer_enable_farkas_callback(callback ? 1 : 0);
      }
    }

    _withCString(value, fn) {
      const ptr = this._module.allocateUTF8(value);
      try {
        return fn(ptr);
      } finally {
        this._module._free(ptr);
      }
    }

    getStage() {
      return this._module._scip_ctx_get_stage();
    }

    hasCurrentNodeLP() {
      return this._module._scip_ctx_has_lp() === 1;
    }

    getLPSolstat() {
      return this._module._scip_ctx_get_lp_solstat();
    }

    getPricingMode() {
      return this._module._scip_ctx_get_pricing_mode();
    }

    isSafeFarkasContext() {
      return this.getPricingMode() !== 2 || this.hasCurrentNodeLP();
    }

    isTransformed() {
      return this._module._scip_ctx_is_transformed() === 1;
    }

    findVarId(name) {
      return this._withCString(name, (ptr) => this._module._scip_var_find_id(ptr));
    }

    findConsId(name) {
      return this._withCString(name, (ptr) => this._module._scip_cons_find_id(ptr));
    }

    getTransformedVarId(varId) {
      return this._module._scip_var_get_transformed(varId);
    }

    getTransformedConsId(consId) {
      return this._module._scip_cons_get_transformed(consId);
    }

    getConsRowId(consId) {
      return this._module._scip_cons_get_row(consId);
    }

    isConsInLP(consId) {
      return this._module._scip_cons_is_in_lp(consId) === 1;
    }

    getConsDualLinear(consId) {
      return this._module._scip_cons_get_dual_linear(consId);
    }

    getConsFarkasLinear(consId) {
      return this._module._scip_cons_get_farkas_linear(consId);
    }

    getRowDual(rowId) {
      return this._module._scip_row_get_dual(rowId);
    }

    getRowFarkas(rowId) {
      return this._module._scip_row_get_farkas(rowId);
    }

    getRowLhs(rowId) {
      return this._module._scip_row_get_lhs(rowId);
    }

    getRowRhs(rowId) {
      return this._module._scip_row_get_rhs(rowId);
    }

    getRowLPPos(rowId) {
      return this._module._scip_row_get_lppos(rowId);
    }

    isRowInLP(rowId) {
      return this._module._scip_row_is_in_lp(rowId) === 1;
    }

    isRowLocal(rowId) {
      return this._module._scip_row_is_local(rowId) === 1;
    }

    getRowName(rowId) {
      const namePtr = this._module._scip_row_get_name(rowId);
      return this._module.UTF8ToString(namePtr);
    }

    getNLProws() {
      return this._module._scip_ctx_get_n_lp_rows();
    }

    getLPRowDualsBatch(n) {
      if (n <= 0) {
        return [];
      }
      const outPtr = this._module._malloc(n * 8);
      try {
        const count = this._module._scip_ctx_get_lp_row_duals_batch(outPtr, n);
        if (count <= 0) {
          return [];
        }
        const out = [];
        let offset = outPtr >> 3;
        for (let i = 0; i < count; i += 1) {
          out.push(this._module.HEAPF64[offset + i]);
        }
        return out;
      } finally {
        this._module._free(outPtr);
      }
    }

    getLPRowFarkasBatch(n) {
      if (n <= 0) {
        return [];
      }
      const outPtr = this._module._malloc(n * 8);
      try {
        const count = this._module._scip_ctx_get_lp_row_farkas_batch(outPtr, n);
        if (count <= 0) {
          return [];
        }
        const out = [];
        let offset = outPtr >> 3;
        for (let i = 0; i < count; i += 1) {
          out.push(this._module.HEAPF64[offset + i]);
        }
        return out;
      } finally {
        this._module._free(outPtr);
      }
    }

    getVarLPValue(varId) {
      return this._module._scip_ctx_get_var_lp_value(varId);
    }

    getVarRedcost(varId) {
      return this._module._scip_ctx_get_var_redcost(varId);
    }

    addVarToRowsBatch(varId, rowIds, vals) {
      if (rowIds.length !== vals.length) {
        throw new Error("rowIds and vals length mismatch");
      }
      const nnz = rowIds.length;
      const rowPtr = this._module._malloc(nnz * 4);
      const valPtr = this._module._malloc(nnz * 8);
      try {
        let rowOffset = rowPtr >> 2;
        let valOffset = valPtr >> 3;
        for (let i = 0; i < nnz; i += 1) {
          this._module.HEAP32[rowOffset + i] = rowIds[i];
          this._module.HEAPF64[valOffset + i] = vals[i];
        }
        const ok = this._module._scip_pricer_add_var_to_rows_batch(varId, rowPtr, valPtr, nnz);
        return ok === 1;
      } finally {
        this._module._free(rowPtr);
        this._module._free(valPtr);
      }
    }

    addVarToConssBatch(varId, consIds, vals) {
      if (consIds.length !== vals.length) {
        throw new Error("consIds and vals length mismatch");
      }
      const nnz = consIds.length;
      const consPtr = this._module._malloc(nnz * 4);
      const valPtr = this._module._malloc(nnz * 8);
      try {
        let consOffset = consPtr >> 2;
        let valOffset = valPtr >> 3;
        for (let i = 0; i < nnz; i += 1) {
          this._module.HEAP32[consOffset + i] = consIds[i];
          this._module.HEAPF64[valOffset + i] = vals[i];
        }
        const ok = this._module._scip_pricer_add_var_to_conss_batch(varId, consPtr, valPtr, nnz);
        return ok === 1;
      } finally {
        this._module._free(consPtr);
        this._module._free(valPtr);
      }
    }

    addPricedVar({ name, lb = 0, ub = 1e20, obj = 0, vartype = 3, initial = 1, removable = 1 }) {
      return this._withCString(name, (ptr) => this._module._scip_pricer_add_priced_var(ptr, lb, ub, obj, vartype, initial, removable));
    }

    includePricer({ name = "js_pricer", desc = "JavaScript pricer", priority = 0, delay = true } = {}) {
      return this._withCString(name, (namePtr) => {
        return this._withCString(desc, (descPtr) => this._module._scip_pricer_include(namePtr, descPtr, priority, delay ? 1 : 0) === 1);
      });
    }

    activatePricer() {
      return this._module._scip_pricer_activate() === 1;
    }

    deactivatePricer() {
      return this._module._scip_pricer_deactivate() === 1;
    }

    isPricerActive() {
      return this._module._scip_pricer_is_active() === 1;
    }

    setPricerResult(resultCode) {
      this._module._scip_pricer_set_result(resultCode);
    }

    setPricerLowerbound(value) {
      this._module._scip_pricer_set_lowerbound(value);
    }

    setPricerStopEarly(flag) {
      this._module._scip_pricer_set_stopearly(flag ? 1 : 0);
    }

    abortPricingRound() {
      this._module._scip_pricer_abort_round();
    }

    getAddedPricedVarCountThisCall() {
      return this._module._scip_pricer_get_n_added_vars_this_call();
    }

    getLastPricingResult() {
      return this._module._scip_pricer_get_last_result();
    }

    getLastPricingMode() {
      return this._module._scip_pricer_get_last_mode();
    }

    getPricerRedcostCalls() {
      return this._module._scip_pricer_get_redcost_calls();
    }

    getPricerFarkasCalls() {
      return this._module._scip_pricer_get_farkas_calls();
    }

    getPricerRound() {
      return this._module._scip_pricer_get_round();
    }

    setParamInt(name, value) {
      return this._withCString(name, (namePtr) => this._module._scip_set_param_int(namePtr, value) === 1);
    }

    setParamReal(name, value) {
      return this._withCString(name, (namePtr) => this._module._scip_set_param_real(namePtr, value) === 1);
    }

    setParamBool(name, value) {
      return this._withCString(name, (namePtr) => this._module._scip_set_param_bool(namePtr, value ? 1 : 0) === 1);
    }

    setParamString(name, value) {
      return this._withCString(name, (namePtr) => {
        return this._withCString(value, (valuePtr) => this._module._scip_set_param_string(namePtr, valuePtr) === 1);
      });
    }

    getResultCodeSuccess() {
      return this._module._scip_result_success();
    }

    getResultCodeDidNotRun() {
      return this._module._scip_result_didnotrun();
    }

    getResultCodeDidNotFind() {
      return this._module._scip_result_didnotfind();
    }

    getAddedPricedVarCount() {
      return this._module._scip_pricer_get_n_added_vars();
    }

    writeLP(path) {
      return this._withCString(path, (ptr) => this._module._scip_model_write_lp(ptr) === 1);
    }

    writeLPSnapshot(prefix = "pricing") {
      return this._withCString(prefix, (ptr) => this._module._scip_model_write_lp_snapshot(ptr) === 1);
    }

    writeMIP(path, genericNames = false, origObj = true, lazyConss = false) {
      return this._withCString(path, (ptr) => this._module._scip_model_write_mip(
        ptr,
        genericNames ? 1 : 0,
        origObj ? 1 : 0,
        lazyConss ? 1 : 0,
      ) === 1);
    }

    async solve(problem, options = {}) {
      if (!this._isInitialized) {
        await this.init(options);
      }

      const {
        format = "lp",
        timeLimit = 3600,
        gap = null,
        initialSolution = null,
        cutoff = null,
      } = options;

      // Reset for new problem
      this._module._scip_reset();

      // Write problem file
      const formatExtMap = { mps: "mps", zpl: "zpl", cip: "cip", lp: "lp" };
      const ext = formatExtMap[format] || "lp";
      const problemFile = `/problems/problem.${ext}`;
      this._module.FS.writeFile(problemFile, problem);

      // Read problem
      const problemFilePtr = this._module.allocateUTF8(problemFile);
      const readOk = this._module._scip_read_problem(problemFilePtr);
      this._module._free(problemFilePtr);

      if (!readOk) {
        return {
          status: Status.ERROR,
          error: "Failed to read problem",
        };
      }

      // Set parameters
      this._module._scip_set_time_limit(timeLimit);

      if (gap !== null) {
        this._module._scip_set_gap(gap);
      }

      if (cutoff !== null) {
        this._module._scip_set_cutoff(cutoff);
      }

      // Add initial solution hint
      if (initialSolution !== null) {
        const solutionStr = Object.entries(initialSolution)
          .map(([name, value]) => `${name}=${value}`)
          .join(";");
        
        const solutionPtr = this._module.allocateUTF8(solutionStr);
        this._module._scip_add_solution_hint(solutionPtr);
        this._module._free(solutionPtr);
      }

      // Enable callbacks if registered
      this._module._scip_enable_incumbent_callback(this._incumbentCallback ? 1 : 0);
      this._module._scip_enable_node_callback(this._nodeCallback ? 1 : 0);
      this._module._scip_pricer_enable_redcost_callback(this._pricerRedcostCallback ? 1 : 0);
      this._module._scip_pricer_enable_farkas_callback(this._pricerFarkasCallback ? 1 : 0);

      // Solve
      const statusCode = this._module._scip_solve();

      // Map status
      const statusMap = {
        0: Status.OPTIMAL,
        1: Status.INFEASIBLE,
        2: Status.UNBOUNDED,
        3: Status.TIME_LIMIT,
        4: Status.UNKNOWN,
        [-1]: Status.ERROR,
      };
      const status = statusMap[statusCode] || Status.UNKNOWN;

      // Get results
      const objective = this._module._scip_get_objective();
      const solvingTime = this._module._scip_get_solving_time();
      const nodes = this._module._scip_get_nnodes();
      const finalGap = this._module._scip_get_gap();
      const dualBound = this._module._scip_get_dual_bound();
      const primalBound = this._module._scip_get_primal_bound();

      // Get variable values
      const variables = {};
      const varNamesPtr = this._module._scip_get_var_names();
      const varNamesStr = this._module.UTF8ToString(varNamesPtr);
      
      if (varNamesStr) {
        const varNames = varNamesStr.split(",");
        for (const name of varNames) {
          if (name) {
            const namePtr = this._module.allocateUTF8(name);
            variables[name] = this._module._scip_get_var_value(namePtr);
            this._module._free(namePtr);
          }
        }
      }

      // Cleanup
      try { this._module.FS.unlink(problemFile); } catch (e) { /* ignore */ }

      return {
        status,
        objective,
        variables,
        statistics: {
          solvingTime,
          nodes,
          gap: finalGap,
          dualBound,
          primalBound,
        },
      };
    }

    destroy() {
      if (this._module) {
        this._module._scip_free();
        this._module = null;
        this._isInitialized = false;
      }
    }
  }

  // Expose to global scope
  global.SCIPApi = SCIPApi;
  global.SCIPStatus = Status;

})(typeof self !== 'undefined' ? self : typeof global !== 'undefined' ? global : this);
