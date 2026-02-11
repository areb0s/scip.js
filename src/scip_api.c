/**
 * SCIP API Wrapper for WebAssembly
 * Provides callback support for JavaScript
 * 
 * This allows JavaScript to:
 * 1. Set initial solutions (warm start)
 * 2. Receive callbacks on new incumbent solutions
 * 3. Implement custom pruning logic
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include "scip/scip.h"
#include "scip/scipdefplugins.h"
#include "scip/cons_linear.h"

// Global SCIP instance for API mode
static SCIP* scip_instance = NULL;

// Pricing mode for callback context (0: none, 1: redcost, 2: farkas)
static int current_pricing_mode = 0;

// Diagnostics for priced variables added through this bridge
static int priced_vars_added = 0;

// JavaScript callback function pointer (set from JS)
static int js_incumbent_callback = 0;
static int js_node_callback = 0;
static int js_pricer_redcost_callback = 0;
static int js_pricer_farkas_callback = 0;

// JS pricer plugin handle
static SCIP_PRICER* js_pricer = NULL;

// Mutable callback outputs for pricer callbacks
static SCIP_RESULT pending_pricer_result = SCIP_SUCCESS;
static SCIP_Real pending_pricer_lowerbound = SCIP_INVALID;
static SCIP_Bool pending_pricer_stopearly = FALSE;
static SCIP_Bool pending_pricer_abortround = FALSE;

// Pricing diagnostics
static int pricer_redcost_calls = 0;
static int pricer_farkas_calls = 0;
static int pricer_round = 0;
static int last_pricing_mode = 0;
static int last_pricing_result = (int)SCIP_DIDNOTRUN;
static int added_vars_this_call = 0;

// Simple handle registries for variables, constraints, and rows
static SCIP_VAR** var_registry = NULL;
static int var_registry_size = 0;
static int var_registry_capacity = 0;

static SCIP_CONS** cons_registry = NULL;
static int cons_registry_size = 0;
static int cons_registry_capacity = 0;

static SCIP_ROW** row_registry = NULL;
static int row_registry_size = 0;
static int row_registry_capacity = 0;

static int ensureVarRegistryCapacity(int needed)
{
    if (needed <= var_registry_capacity) {
        return 1;
    }

    int newcap = var_registry_capacity == 0 ? 64 : var_registry_capacity;
    while (newcap < needed) {
        newcap *= 2;
    }

    SCIP_VAR** next = (SCIP_VAR**)realloc(var_registry, (size_t)newcap * sizeof(SCIP_VAR*));
    if (next == NULL) {
        return 0;
    }

    var_registry = next;
    var_registry_capacity = newcap;
    return 1;
}

static int ensureConsRegistryCapacity(int needed)
{
    if (needed <= cons_registry_capacity) {
        return 1;
    }

    int newcap = cons_registry_capacity == 0 ? 64 : cons_registry_capacity;
    while (newcap < needed) {
        newcap *= 2;
    }

    SCIP_CONS** next = (SCIP_CONS**)realloc(cons_registry, (size_t)newcap * sizeof(SCIP_CONS*));
    if (next == NULL) {
        return 0;
    }

    cons_registry = next;
    cons_registry_capacity = newcap;
    return 1;
}

static int ensureRowRegistryCapacity(int needed)
{
    if (needed <= row_registry_capacity) {
        return 1;
    }

    int newcap = row_registry_capacity == 0 ? 64 : row_registry_capacity;
    while (newcap < needed) {
        newcap *= 2;
    }

    SCIP_ROW** next = (SCIP_ROW**)realloc(row_registry, (size_t)newcap * sizeof(SCIP_ROW*));
    if (next == NULL) {
        return 0;
    }

    row_registry = next;
    row_registry_capacity = newcap;
    return 1;
}

static void clearRegistries(void)
{
    free(var_registry);
    var_registry = NULL;
    var_registry_size = 0;
    var_registry_capacity = 0;

    free(cons_registry);
    cons_registry = NULL;
    cons_registry_size = 0;
    cons_registry_capacity = 0;

    free(row_registry);
    row_registry = NULL;
    row_registry_size = 0;
    row_registry_capacity = 0;
}

static void resetPricingState(void)
{
    pending_pricer_result = SCIP_SUCCESS;
    pending_pricer_lowerbound = SCIP_INVALID;
    pending_pricer_stopearly = FALSE;
    pending_pricer_abortround = FALSE;
    pricer_redcost_calls = 0;
    pricer_farkas_calls = 0;
    pricer_round = 0;
    last_pricing_mode = 0;
    last_pricing_result = (int)SCIP_DIDNOTRUN;
    added_vars_this_call = 0;
    current_pricing_mode = 0;
    priced_vars_added = 0;
}

static void clearCurrentProblem(void)
{
    if (scip_instance == NULL) {
        return;
    }

    SCIP_STAGE stage = SCIPgetStage(scip_instance);

    if (stage >= SCIP_STAGE_SOLVING) {
        (void)SCIPfreeTransform(scip_instance);
        stage = SCIPgetStage(scip_instance);
    }

    if (stage >= SCIP_STAGE_PROBLEM) {
        (void)SCIPfreeProb(scip_instance);
    }
}

static int registerVarHandle(SCIP_VAR* var)
{
    if (var == NULL) {
        return -1;
    }

    for (int i = 0; i < var_registry_size; ++i) {
        if (var_registry[i] == var) {
            return i + 1;
        }
    }

    if (!ensureVarRegistryCapacity(var_registry_size + 1)) {
        return -1;
    }

    var_registry[var_registry_size] = var;
    var_registry_size += 1;
    return var_registry_size;
}

static int registerConsHandle(SCIP_CONS* cons)
{
    if (cons == NULL) {
        return -1;
    }

    for (int i = 0; i < cons_registry_size; ++i) {
        if (cons_registry[i] == cons) {
            return i + 1;
        }
    }

    if (!ensureConsRegistryCapacity(cons_registry_size + 1)) {
        return -1;
    }

    cons_registry[cons_registry_size] = cons;
    cons_registry_size += 1;
    return cons_registry_size;
}

static int registerRowHandle(SCIP_ROW* row)
{
    if (row == NULL) {
        return -1;
    }

    for (int i = 0; i < row_registry_size; ++i) {
        if (row_registry[i] == row) {
            return i + 1;
        }
    }

    if (!ensureRowRegistryCapacity(row_registry_size + 1)) {
        return -1;
    }

    row_registry[row_registry_size] = row;
    row_registry_size += 1;
    return row_registry_size;
}

static SCIP_VAR* getVarByHandle(int varId)
{
    if (varId <= 0 || varId > var_registry_size) {
        return NULL;
    }
    return var_registry[varId - 1];
}

static SCIP_CONS* getConsByHandle(int consId)
{
    if (consId <= 0 || consId > cons_registry_size) {
        return NULL;
    }
    return cons_registry[consId - 1];
}

static SCIP_ROW* getRowByHandle(int rowId)
{
    if (rowId <= 0 || rowId > row_registry_size) {
        return NULL;
    }
    return row_registry[rowId - 1];
}

// Event handler data
typedef struct {
    int callback_id;
} EVENTHDLRDATA;

// ============================================
// Event Handler: Called when new solution found
// ============================================
static SCIP_DECL_EVENTEXEC(eventExecBestSol)
{
    SCIP_SOL* sol;
    SCIP_Real objval;
    
    sol = SCIPgetBestSol(scip);
    if (sol != NULL) {
        objval = SCIPgetSolOrigObj(scip, sol);
        
        // Call JavaScript callback if registered
        if (js_incumbent_callback != 0) {
            // Call JS function with objective value
            EM_ASM({
                if (Module.onIncumbent) {
                    Module.onIncumbent($0);
                }
            }, objval);
        }
    }
    
    return SCIP_OKAY;
}

// ============================================
// Event Handler: Called when node is selected
// ============================================
static SCIP_DECL_EVENTEXEC(eventExecNode)
{
    SCIP_Real dualbound;
    SCIP_Real primalbound;
    SCIP_Longint nnodes;
    
    dualbound = SCIPgetDualbound(scip);
    primalbound = SCIPgetPrimalbound(scip);
    nnodes = SCIPgetNNodes(scip);
    
    // Call JavaScript callback if registered
    if (js_node_callback != 0) {
        EM_ASM({
            if (Module.onNode) {
                Module.onNode($0, $1, $2);
            }
        }, dualbound, primalbound, (double)nnodes);
    }
    
    return SCIP_OKAY;
}

// ============================================
// Include event handlers
// ============================================
static SCIP_RETCODE includeEventHandlers(SCIP* scip)
{
    SCIP_EVENTHDLR* eventhdlr;
    
    // Best solution found event
    SCIP_CALL(SCIPincludeEventhdlrBasic(scip, &eventhdlr, "bestsol_js",
        "JavaScript callback for best solution found",
        eventExecBestSol, NULL));
    SCIP_CALL(SCIPsetEventhdlrInit(scip, eventhdlr, NULL));
    
    return SCIP_OKAY;
}

// ============================================
// Pricer callbacks (JavaScript bridge)
// ============================================
static SCIP_DECL_PRICERREDCOST(pricerRedcostJs)
{
    (void)pricer;

    current_pricing_mode = 1;
    last_pricing_mode = 1;
    pricer_redcost_calls += 1;
    pricer_round += 1;
    added_vars_this_call = 0;
    pending_pricer_result = SCIP_SUCCESS;
    pending_pricer_lowerbound = SCIP_INVALID;
    pending_pricer_stopearly = FALSE;
    pending_pricer_abortround = FALSE;

    if (js_pricer_redcost_callback != 0) {
        EM_ASM({
            if (Module.onPricerRedcost) {
                Module.onPricerRedcost();
            }
        });
    }

    if (pending_pricer_abortround) {
        pending_pricer_result = SCIP_DIDNOTRUN;
        pending_pricer_stopearly = TRUE;
        SCIPinterruptSolve(scip);
    }

    if (lowerbound != NULL && pending_pricer_lowerbound != SCIP_INVALID) {
        *lowerbound = pending_pricer_lowerbound;
    }

    if (stopearly != NULL) {
        *stopearly = pending_pricer_stopearly;
    }

    if (result != NULL) {
        *result = pending_pricer_result;
    }

    last_pricing_result = (int)pending_pricer_result;

    current_pricing_mode = 0;
    return SCIP_OKAY;
}

static SCIP_DECL_PRICERFARKAS(pricerFarkasJs)
{
    (void)pricer;

    current_pricing_mode = 2;
    last_pricing_mode = 2;
    pricer_farkas_calls += 1;
    pricer_round += 1;
    added_vars_this_call = 0;
    pending_pricer_result = SCIP_SUCCESS;
    pending_pricer_abortround = FALSE;

    if (!SCIPhasCurrentNodeLP(scip)) {
        pending_pricer_result = SCIP_DIDNOTRUN;
        last_pricing_result = (int)pending_pricer_result;
        current_pricing_mode = 0;
        if (result != NULL) {
            *result = pending_pricer_result;
        }
        return SCIP_OKAY;
    }

    if (js_pricer_farkas_callback != 0) {
        EM_ASM({
            if (Module.onPricerFarkas) {
                Module.onPricerFarkas();
            }
        });
    }

    if (pending_pricer_abortround) {
        pending_pricer_result = SCIP_DIDNOTRUN;
        SCIPinterruptSolve(scip);
    }

    if (result != NULL) {
        *result = pending_pricer_result;
    }

    last_pricing_result = (int)pending_pricer_result;

    current_pricing_mode = 0;
    return SCIP_OKAY;
}

// ============================================
// Exported API Functions
// ============================================

/**
 * Create and initialize SCIP instance
 */
EMSCRIPTEN_KEEPALIVE
int scip_create(void)
{
    if (scip_instance != NULL) {
        return 0; // Already created
    }
    
    SCIP_CALL(SCIPcreate(&scip_instance));
    SCIP_CALL(SCIPincludeDefaultPlugins(scip_instance));
    SCIP_CALL(includeEventHandlers(scip_instance));
    
    // Catch best solution events
    SCIP_CALL(SCIPcatchEvent(scip_instance, SCIP_EVENTTYPE_BESTSOLFOUND, 
        SCIPfindEventhdlr(scip_instance, "bestsol_js"), NULL, NULL));
    
    return 1;
}

/**
 * Free SCIP instance
 */
EMSCRIPTEN_KEEPALIVE
void scip_free(void)
{
    if (scip_instance != NULL) {
        clearCurrentProblem();
        SCIPfree(&scip_instance);
        scip_instance = NULL;
    }
    js_pricer = NULL;
    js_pricer_redcost_callback = 0;
    js_pricer_farkas_callback = 0;
    resetPricingState();
    clearRegistries();
}

EMSCRIPTEN_KEEPALIVE
int scip_problem_clear(void)
{
    if (scip_instance == NULL) {
        return 0;
    }

    clearCurrentProblem();
    resetPricingState();
    clearRegistries();
    js_pricer = NULL;
    js_pricer_redcost_callback = 0;
    js_pricer_farkas_callback = 0;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
int scip_problem_begin(const char* name, int maximize)
{
    if (scip_instance == NULL) {
        return 0;
    }

    clearCurrentProblem();
    resetPricingState();
    clearRegistries();
    js_pricer = NULL;
    js_pricer_redcost_callback = 0;
    js_pricer_farkas_callback = 0;

    const char* problemname = (name != NULL && name[0] != '\0') ? name : "js_problem";
    if (SCIPcreateProbBasic(scip_instance, problemname) != SCIP_OKAY) {
        return 0;
    }

    SCIP_OBJSENSE sense = maximize ? SCIP_OBJSENSE_MAXIMIZE : SCIP_OBJSENSE_MINIMIZE;
    if (SCIPsetObjsense(scip_instance, sense) != SCIP_OKAY) {
        return 0;
    }

    return 1;
}

EMSCRIPTEN_KEEPALIVE
int scip_add_cons_linear(
    const char* name,
    double lhs,
    double rhs,
    int initial,
    int separate,
    int enforce,
    int check,
    int propagate,
    int local,
    int modifiable,
    int dynamic,
    int removable,
    int stickingatnode)
{
    if (scip_instance == NULL || name == NULL) {
        return -1;
    }

    SCIP_CONS* cons = NULL;
    SCIP_RETCODE ret = SCIPcreateConsLinear(
        scip_instance,
        &cons,
        name,
        0,
        NULL,
        NULL,
        lhs,
        rhs,
        initial ? TRUE : FALSE,
        separate ? TRUE : FALSE,
        enforce ? TRUE : FALSE,
        check ? TRUE : FALSE,
        propagate ? TRUE : FALSE,
        local ? TRUE : FALSE,
        modifiable ? TRUE : FALSE,
        dynamic ? TRUE : FALSE,
        removable ? TRUE : FALSE,
        stickingatnode ? TRUE : FALSE);

    if (ret != SCIP_OKAY || cons == NULL) {
        return -1;
    }

    ret = SCIPaddCons(scip_instance, cons);
    if (ret != SCIP_OKAY) {
        SCIPreleaseCons(scip_instance, &cons);
        return -1;
    }

    int consId = registerConsHandle(cons);
    SCIPreleaseCons(scip_instance, &cons);
    return consId;
}

EMSCRIPTEN_KEEPALIVE
int scip_set_cons_modifiable(int consId, int modifiable)
{
    if (scip_instance == NULL) {
        return 0;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    if (cons == NULL) {
        return 0;
    }

    return SCIPsetConsModifiable(scip_instance, cons, modifiable ? TRUE : FALSE) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_add_var(
    const char* name,
    double lb,
    double ub,
    double obj,
    int vartype,
    int initial,
    int removable)
{
    if (scip_instance == NULL || name == NULL) {
        return -1;
    }

    SCIP_VAR* var = NULL;
    SCIP_RETCODE ret = SCIPcreateVarBasic(scip_instance, &var, name, lb, ub, obj, (SCIP_VARTYPE)vartype);
    if (ret != SCIP_OKAY || var == NULL) {
        return -1;
    }

    SCIP_CALL_ABORT(SCIPvarSetInitial(var, initial ? TRUE : FALSE));
    SCIP_CALL_ABORT(SCIPvarSetRemovable(var, removable ? TRUE : FALSE));

    ret = SCIPaddVar(scip_instance, var);
    if (ret != SCIP_OKAY) {
        SCIP_CALL_ABORT(SCIPreleaseVar(scip_instance, &var));
        return -1;
    }

    int varId = registerVarHandle(var);
    SCIP_CALL_ABORT(SCIPreleaseVar(scip_instance, &var));
    return varId;
}

EMSCRIPTEN_KEEPALIVE
int scip_add_coef_linear(int consId, int varId, double val)
{
    if (scip_instance == NULL) {
        return 0;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    SCIP_VAR* var = getVarByHandle(varId);
    if (cons == NULL || var == NULL) {
        return 0;
    }

    return SCIPaddCoefLinear(scip_instance, cons, var, val) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_add_coef_linear_batch(int consId, int* varIds, double* vals, int nnz)
{
    if (scip_instance == NULL || varIds == NULL || vals == NULL || nnz < 0) {
        return 0;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    if (cons == NULL) {
        return 0;
    }

    for (int i = 0; i < nnz; ++i) {
        SCIP_VAR* var = getVarByHandle(varIds[i]);
        if (var == NULL) {
            return 0;
        }
        if (SCIPaddCoefLinear(scip_instance, cons, var, vals[i]) != SCIP_OKAY) {
            return 0;
        }
    }

    return 1;
}

/**
 * Read problem from file
 */
EMSCRIPTEN_KEEPALIVE
int scip_read_problem(const char* filename)
{
    if (scip_instance == NULL) {
        return 0;
    }
    
    SCIP_RETCODE retcode = SCIPreadProb(scip_instance, filename, NULL);
    return retcode == SCIP_OKAY ? 1 : 0;
}

/**
 * Set time limit
 */
EMSCRIPTEN_KEEPALIVE
void scip_set_time_limit(double seconds)
{
    if (scip_instance != NULL) {
        SCIPsetRealParam(scip_instance, "limits/time", seconds);
    }
}

/**
 * Set gap tolerance
 */
EMSCRIPTEN_KEEPALIVE
void scip_set_gap(double gap)
{
    if (scip_instance != NULL) {
        SCIPsetRealParam(scip_instance, "limits/gap", gap);
    }
}

EMSCRIPTEN_KEEPALIVE
int scip_set_param_int(const char* name, int value)
{
    if (scip_instance == NULL || name == NULL) {
        return 0;
    }
    return SCIPsetIntParam(scip_instance, name, value) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_set_param_real(const char* name, double value)
{
    if (scip_instance == NULL || name == NULL) {
        return 0;
    }
    return SCIPsetRealParam(scip_instance, name, value) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_set_param_bool(const char* name, int value)
{
    if (scip_instance == NULL || name == NULL) {
        return 0;
    }
    return SCIPsetBoolParam(scip_instance, name, value ? TRUE : FALSE) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_set_param_string(const char* name, const char* value)
{
    if (scip_instance == NULL || name == NULL || value == NULL) {
        return 0;
    }
    return SCIPsetStringParam(scip_instance, name, value) == SCIP_OKAY ? 1 : 0;
}

/**
 * Add initial solution hint
 * Variables are passed as name,value pairs separated by semicolons
 * Example: "x=1;y=2;z=3"
 */
EMSCRIPTEN_KEEPALIVE
int scip_add_solution_hint(const char* solution_str)
{
    if (scip_instance == NULL || solution_str == NULL) {
        return 0;
    }
    
    SCIP_SOL* sol;
    SCIP_Bool stored;
    
    // Create solution
    SCIP_CALL_ABORT(SCIPcreateSol(scip_instance, &sol, NULL));
    
    // Parse solution string
    char* str = strdup(solution_str);
    char* token = strtok(str, ";");
    
    while (token != NULL) {
        char varname[256];
        double value;
        
        if (sscanf(token, "%255[^=]=%lf", varname, &value) == 2) {
            SCIP_VAR* var = SCIPfindVar(scip_instance, varname);
            if (var != NULL) {
                SCIPsetSolVal(scip_instance, sol, var, value);
            }
        }
        
        token = strtok(NULL, ";");
    }
    
    free(str);
    
    // Try to add solution
    SCIP_CALL_ABORT(SCIPtrySol(scip_instance, sol, FALSE, FALSE, FALSE, FALSE, FALSE, &stored));
    SCIP_CALL_ABORT(SCIPfreeSol(scip_instance, &sol));
    
    return stored ? 1 : 0;
}

/**
 * Set cutoff bound (prune nodes with worse bounds)
 */
EMSCRIPTEN_KEEPALIVE
void scip_set_cutoff(double cutoff)
{
    if (scip_instance != NULL) {
        SCIPsetObjlimit(scip_instance, cutoff);
    }
}

/**
 * Solve the problem
 */
EMSCRIPTEN_KEEPALIVE
int scip_solve(void)
{
    if (scip_instance == NULL) {
        return -1;
    }

    current_pricing_mode = 0;
    added_vars_this_call = 0;
    
    SCIP_RETCODE retcode = SCIPsolve(scip_instance);
    
    if (retcode != SCIP_OKAY) {
        return -1;
    }
    
    SCIP_STATUS status = SCIPgetStatus(scip_instance);
    
    switch (status) {
        case SCIP_STATUS_OPTIMAL:
            return 0;
        case SCIP_STATUS_INFEASIBLE:
            return 1;
        case SCIP_STATUS_UNBOUNDED:
            return 2;
        case SCIP_STATUS_TIMELIMIT:
            return 3;
        default:
            return 4;
    }
}

/**
 * Get objective value
 */
EMSCRIPTEN_KEEPALIVE
double scip_get_objective(void)
{
    if (scip_instance == NULL) {
        return 0.0;
    }
    
    SCIP_SOL* sol = SCIPgetBestSol(scip_instance);
    if (sol == NULL) {
        return 0.0;
    }
    
    return SCIPgetSolOrigObj(scip_instance, sol);
}

/**
 * Get solution value for a variable
 */
EMSCRIPTEN_KEEPALIVE
double scip_get_var_value(const char* varname)
{
    if (scip_instance == NULL || varname == NULL) {
        return 0.0;
    }
    
    SCIP_SOL* sol = SCIPgetBestSol(scip_instance);
    if (sol == NULL) {
        return 0.0;
    }
    
    SCIP_VAR* var = SCIPfindVar(scip_instance, varname);
    if (var == NULL) {
        return 0.0;
    }
    
    return SCIPgetSolVal(scip_instance, sol, var);
}

/**
 * Get number of variables
 */
EMSCRIPTEN_KEEPALIVE
int scip_get_nvars(void)
{
    if (scip_instance == NULL) {
        return 0;
    }
    return SCIPgetNVars(scip_instance);
}

/**
 * Get all variable names (comma separated)
 */
EMSCRIPTEN_KEEPALIVE
const char* scip_get_var_names(void)
{
    static char buffer[65536];
    buffer[0] = '\0';
    
    if (scip_instance == NULL) {
        return buffer;
    }
    
    SCIP_VAR** vars = SCIPgetVars(scip_instance);
    int nvars = SCIPgetNVars(scip_instance);
    
    int pos = 0;
    for (int i = 0; i < nvars && pos < 65000; i++) {
        const char* name = SCIPvarGetName(vars[i]);
        if (i > 0) {
            buffer[pos++] = ',';
        }
        int len = strlen(name);
        memcpy(buffer + pos, name, len);
        pos += len;
    }
    buffer[pos] = '\0';
    
    return buffer;
}

EMSCRIPTEN_KEEPALIVE
double scip_ctx_get_var_lp_value(int varId)
{
    if (scip_instance == NULL) {
        return 0.0;
    }

    if (SCIPgetStage(scip_instance) != SCIP_STAGE_SOLVING) {
        return 0.0;
    }

    SCIP_VAR* var = getVarByHandle(varId);
    if (var == NULL) {
        return 0.0;
    }

    return SCIPgetVarSol(scip_instance, var);
}

EMSCRIPTEN_KEEPALIVE
double scip_ctx_get_var_redcost(int varId)
{
    if (scip_instance == NULL) {
        return 0.0;
    }

    if (SCIPgetStage(scip_instance) != SCIP_STAGE_SOLVING) {
        return 0.0;
    }

    SCIP_VAR* var = getVarByHandle(varId);
    if (var == NULL) {
        return 0.0;
    }

    return SCIPgetVarRedcost(scip_instance, var);
}

/**
 * Get solving statistics
 */
EMSCRIPTEN_KEEPALIVE
double scip_get_solving_time(void)
{
    if (scip_instance == NULL) return 0.0;
    return SCIPgetSolvingTime(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
long long scip_get_nnodes(void)
{
    if (scip_instance == NULL) return 0;
    return SCIPgetNNodes(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
double scip_get_gap(void)
{
    if (scip_instance == NULL) return 0.0;
    return SCIPgetGap(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
double scip_get_dual_bound(void)
{
    if (scip_instance == NULL) return 0.0;
    return SCIPgetDualbound(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
double scip_get_primal_bound(void)
{
    if (scip_instance == NULL) return 0.0;
    return SCIPgetPrimalbound(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_get_stage(void)
{
    if (scip_instance == NULL) {
        return -1;
    }
    return (int)SCIPgetStage(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_has_lp(void)
{
    if (scip_instance == NULL) {
        return 0;
    }

    if (SCIPgetStage(scip_instance) != SCIP_STAGE_SOLVING) {
        return 0;
    }

    return SCIPhasCurrentNodeLP(scip_instance) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_get_lp_solstat(void)
{
    if (scip_instance == NULL) {
        return -1;
    }

    if (SCIPgetStage(scip_instance) != SCIP_STAGE_SOLVING) {
        return -1;
    }

    return (int)SCIPgetLPSolstat(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_get_pricing_mode(void)
{
    return current_pricing_mode;
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_is_transformed(void)
{
    if (scip_instance == NULL) {
        return 0;
    }
    return SCIPisTransformed(scip_instance) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_var_find_id(const char* name)
{
    if (scip_instance == NULL || name == NULL) {
        return -1;
    }

    SCIP_VAR* var = SCIPfindVar(scip_instance, name);
    return registerVarHandle(var);
}

EMSCRIPTEN_KEEPALIVE
int scip_cons_find_id(const char* name)
{
    if (scip_instance == NULL || name == NULL) {
        return -1;
    }

    SCIP_CONS* cons = SCIPfindCons(scip_instance, name);
    return registerConsHandle(cons);
}

EMSCRIPTEN_KEEPALIVE
int scip_var_get_transformed(int varId)
{
    if (scip_instance == NULL) {
        return -1;
    }

    if (!SCIPisTransformed(scip_instance)) {
        return -1;
    }

    SCIP_VAR* var = getVarByHandle(varId);
    if (var == NULL) {
        return -1;
    }

    if (SCIPvarIsTransformed(var)) {
        return varId;
    }

    SCIP_VAR* transvar = NULL;
    SCIP_RETCODE ret = SCIPgetTransformedVar(scip_instance, var, &transvar);
    if (ret != SCIP_OKAY || transvar == NULL) {
        return -1;
    }

    return registerVarHandle(transvar);
}

EMSCRIPTEN_KEEPALIVE
int scip_cons_get_transformed(int consId)
{
    if (scip_instance == NULL) {
        return -1;
    }

    if (!SCIPisTransformed(scip_instance)) {
        return -1;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    if (cons == NULL) {
        return -1;
    }

    if (SCIPconsIsTransformed(cons)) {
        return consId;
    }

    SCIP_CONS* transcons = NULL;
    SCIP_RETCODE ret = SCIPgetTransformedCons(scip_instance, cons, &transcons);
    if (ret != SCIP_OKAY || transcons == NULL) {
        return -1;
    }

    return registerConsHandle(transcons);
}

EMSCRIPTEN_KEEPALIVE
int scip_cons_get_row(int consId)
{
    if (scip_instance == NULL) {
        return -1;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    if (cons == NULL) {
        return -1;
    }

    SCIP_ROW* row = SCIPgetRowLinear(scip_instance, cons);
    if (row == NULL) {
        return -1;
    }

    return registerRowHandle(row);
}

EMSCRIPTEN_KEEPALIVE
int scip_cons_is_in_lp(int consId)
{
    int rowId = scip_cons_get_row(consId);
    if (rowId <= 0) {
        return 0;
    }

    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0;
    }

    return SCIProwIsInLP(row) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
double scip_cons_get_dual_linear(int consId)
{
    if (scip_instance == NULL) {
        return 0.0;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    if (cons == NULL) {
        return 0.0;
    }

    return SCIPgetDualsolLinear(scip_instance, cons);
}

EMSCRIPTEN_KEEPALIVE
double scip_cons_get_farkas_linear(int consId)
{
    if (scip_instance == NULL) {
        return 0.0;
    }

    SCIP_CONS* cons = getConsByHandle(consId);
    if (cons == NULL) {
        return 0.0;
    }

    return SCIPgetDualfarkasLinear(scip_instance, cons);
}

EMSCRIPTEN_KEEPALIVE
double scip_row_get_dual(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0.0;
    }
    return SCIProwGetDualsol(row);
}

EMSCRIPTEN_KEEPALIVE
double scip_row_get_farkas(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0.0;
    }
    return SCIProwGetDualfarkas(row);
}

EMSCRIPTEN_KEEPALIVE
double scip_row_get_lhs(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0.0;
    }
    return SCIProwGetLhs(row);
}

EMSCRIPTEN_KEEPALIVE
double scip_row_get_rhs(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0.0;
    }
    return SCIProwGetRhs(row);
}

EMSCRIPTEN_KEEPALIVE
int scip_row_get_lppos(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return -1;
    }
    return SCIProwGetLPPos(row);
}

EMSCRIPTEN_KEEPALIVE
int scip_row_is_in_lp(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0;
    }
    return SCIProwIsInLP(row) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_row_is_local(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return 0;
    }
    return SCIProwIsLocal(row) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
const char* scip_row_get_name(int rowId)
{
    SCIP_ROW* row = getRowByHandle(rowId);
    if (row == NULL) {
        return "";
    }
    return SCIProwGetName(row);
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_get_n_lp_rows(void)
{
    if (scip_instance == NULL) {
        return 0;
    }

    if (SCIPgetStage(scip_instance) != SCIP_STAGE_SOLVING) {
        return 0;
    }

    if (!SCIPisLPConstructed(scip_instance)) {
        return 0;
    }

    return SCIPgetNLPRows(scip_instance);
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_get_lp_row_duals_batch(double* out, int n)
{
    if (scip_instance == NULL || out == NULL || n <= 0) {
        return -1;
    }

    int nrows = scip_ctx_get_n_lp_rows();
    if (nrows <= 0) {
        return 0;
    }

    SCIP_ROW** rows = SCIPgetLPRows(scip_instance);
    int count = n < nrows ? n : nrows;

    for (int i = 0; i < count; ++i) {
        out[i] = SCIProwGetDualsol(rows[i]);
        registerRowHandle(rows[i]);
    }

    return count;
}

EMSCRIPTEN_KEEPALIVE
int scip_ctx_get_lp_row_farkas_batch(double* out, int n)
{
    if (scip_instance == NULL || out == NULL || n <= 0) {
        return -1;
    }

    int nrows = scip_ctx_get_n_lp_rows();
    if (nrows <= 0) {
        return 0;
    }

    SCIP_ROW** rows = SCIPgetLPRows(scip_instance);
    int count = n < nrows ? n : nrows;

    for (int i = 0; i < count; ++i) {
        out[i] = SCIProwGetDualfarkas(rows[i]);
        registerRowHandle(rows[i]);
    }

    return count;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_add_var_to_rows_batch(int varId, int* rowIds, double* vals, int nnz)
{
    if (scip_instance == NULL || rowIds == NULL || vals == NULL || nnz < 0) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        return -1;
    }

    SCIP_VAR* var = getVarByHandle(varId);
    if (var == NULL) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        return -1;
    }

    for (int i = 0; i < nnz; ++i) {
        if (getRowByHandle(rowIds[i]) == NULL) {
            pending_pricer_abortround = TRUE;
            pending_pricer_result = SCIP_DIDNOTRUN;
            return -1;
        }
    }

    for (int i = 0; i < nnz; ++i) {
        SCIP_ROW* row = getRowByHandle(rowIds[i]);
        SCIP_RETCODE ret = SCIPaddVarToRow(scip_instance, row, var, vals[i]);
        if (ret != SCIP_OKAY) {
            pending_pricer_abortround = TRUE;
            pending_pricer_result = SCIP_DIDNOTRUN;
            pending_pricer_stopearly = TRUE;
            SCIPinterruptSolve(scip_instance);
            return -1;
        }
    }

    return 1;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_add_var_to_conss_batch(int varId, int* consIds, double* vals, int nnz)
{
    if (scip_instance == NULL || consIds == NULL || vals == NULL || nnz < 0) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        return -1;
    }

    SCIP_VAR* var = getVarByHandle(varId);
    if (var == NULL) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        return -1;
    }

    for (int i = 0; i < nnz; ++i) {
        if (getConsByHandle(consIds[i]) == NULL) {
            pending_pricer_abortround = TRUE;
            pending_pricer_result = SCIP_DIDNOTRUN;
            return -1;
        }
    }

    for (int i = 0; i < nnz; ++i) {
        SCIP_CONS* cons = getConsByHandle(consIds[i]);
        SCIP_RETCODE ret = SCIPaddCoefLinear(scip_instance, cons, var, vals[i]);
        if (ret != SCIP_OKAY) {
            pending_pricer_abortround = TRUE;
            pending_pricer_result = SCIP_DIDNOTRUN;
            pending_pricer_stopearly = TRUE;
            SCIPinterruptSolve(scip_instance);
            return -1;
        }
    }

    return 1;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_add_priced_var(const char* name, double lb, double ub, double obj, int vartype, int initial, int removable)
{
    if (scip_instance == NULL || name == NULL) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        return -1;
    }

    SCIP_VAR* var = NULL;
    SCIP_RETCODE ret = SCIPcreateVarBasic(scip_instance, &var, name, lb, ub, obj, (SCIP_VARTYPE)vartype);
    if (ret != SCIP_OKAY || var == NULL) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        return -1;
    }

    SCIP_CALL_ABORT(SCIPvarSetInitial(var, initial ? TRUE : FALSE));
    SCIP_CALL_ABORT(SCIPvarSetRemovable(var, removable ? TRUE : FALSE));

    ret = SCIPaddPricedVar(scip_instance, var, 1.0);
    if (ret != SCIP_OKAY) {
        pending_pricer_abortround = TRUE;
        pending_pricer_result = SCIP_DIDNOTRUN;
        SCIP_CALL_ABORT(SCIPreleaseVar(scip_instance, &var));
        return -1;
    }

    int varId = registerVarHandle(var);
    priced_vars_added += 1;
    added_vars_this_call += 1;
    SCIP_CALL_ABORT(SCIPreleaseVar(scip_instance, &var));
    return varId;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_n_added_vars(void)
{
    return priced_vars_added;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_n_added_vars_this_call(void)
{
    return added_vars_this_call;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_last_result(void)
{
    return last_pricing_result;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_last_mode(void)
{
    return last_pricing_mode;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_redcost_calls(void)
{
    return pricer_redcost_calls;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_farkas_calls(void)
{
    return pricer_farkas_calls;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_get_round(void)
{
    return pricer_round;
}

EMSCRIPTEN_KEEPALIVE
void scip_pricer_abort_round(void)
{
    pending_pricer_abortround = TRUE;
    pending_pricer_result = SCIP_DIDNOTRUN;
    pending_pricer_stopearly = TRUE;
    if (scip_instance != NULL) {
        SCIPinterruptSolve(scip_instance);
    }
}

EMSCRIPTEN_KEEPALIVE
int scip_model_write_lp(const char* filename)
{
    if (scip_instance == NULL || filename == NULL) {
        return 0;
    }
    return SCIPwriteLP(scip_instance, filename) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_model_write_mip(const char* filename, int genericnames, int origobj, int lazyconss)
{
    if (scip_instance == NULL || filename == NULL) {
        return 0;
    }
    return SCIPwriteMIP(scip_instance, filename,
        genericnames ? TRUE : FALSE,
        origobj ? TRUE : FALSE,
        lazyconss ? TRUE : FALSE) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_model_write_lp_snapshot(const char* prefix)
{
    if (scip_instance == NULL || prefix == NULL) {
        return 0;
    }

    char filename[512];
    snprintf(filename, sizeof(filename), "%s_%d_%d.lp", prefix, current_pricing_mode, pricer_round);
    return SCIPwriteLP(scip_instance, filename) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_include(const char* name, const char* desc, int priority, int delay)
{
    if (scip_instance == NULL || name == NULL || desc == NULL) {
        return 0;
    }

    if (js_pricer != NULL) {
        return 1;
    }

    SCIP_RETCODE ret = SCIPincludePricerBasic(
        scip_instance,
        &js_pricer,
        name,
        desc,
        priority,
        delay ? TRUE : FALSE,
        pricerRedcostJs,
        pricerFarkasJs,
        NULL
    );

    return ret == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_activate(void)
{
    if (scip_instance == NULL || js_pricer == NULL) {
        return 0;
    }

    return SCIPactivatePricer(scip_instance, js_pricer) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_deactivate(void)
{
    if (scip_instance == NULL || js_pricer == NULL) {
        return 0;
    }

    return SCIPdeactivatePricer(scip_instance, js_pricer) == SCIP_OKAY ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
int scip_pricer_is_active(void)
{
    if (js_pricer == NULL) {
        return 0;
    }
    return SCIPpricerIsActive(js_pricer) ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void scip_pricer_enable_redcost_callback(int enable)
{
    js_pricer_redcost_callback = enable ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void scip_pricer_enable_farkas_callback(int enable)
{
    js_pricer_farkas_callback = enable ? 1 : 0;
}

EMSCRIPTEN_KEEPALIVE
void scip_pricer_set_result(int resultcode)
{
    pending_pricer_result = (SCIP_RESULT)resultcode;
    last_pricing_result = resultcode;
}

EMSCRIPTEN_KEEPALIVE
void scip_pricer_set_lowerbound(double lowerbound)
{
    pending_pricer_lowerbound = lowerbound;
}

EMSCRIPTEN_KEEPALIVE
void scip_pricer_set_stopearly(int stopearly)
{
    pending_pricer_stopearly = stopearly ? TRUE : FALSE;
}

EMSCRIPTEN_KEEPALIVE
int scip_result_success(void)
{
    return (int)SCIP_SUCCESS;
}

EMSCRIPTEN_KEEPALIVE
int scip_result_didnotrun(void)
{
    return (int)SCIP_DIDNOTRUN;
}

EMSCRIPTEN_KEEPALIVE
int scip_result_didnotfind(void)
{
    return (int)SCIP_DIDNOTFIND;
}

/**
 * Reset for new problem
 */
EMSCRIPTEN_KEEPALIVE
void scip_reset(void)
{
    clearCurrentProblem();
    resetPricingState();
    clearRegistries();
    js_pricer = NULL;
    js_pricer_redcost_callback = 0;
    js_pricer_farkas_callback = 0;
}

/**
 * Enable/disable incumbent callback
 */
EMSCRIPTEN_KEEPALIVE
void scip_enable_incumbent_callback(int enable)
{
    js_incumbent_callback = enable;
}

/**
 * Enable/disable node callback
 */
EMSCRIPTEN_KEEPALIVE
void scip_enable_node_callback(int enable)
{
    js_node_callback = enable;
}
