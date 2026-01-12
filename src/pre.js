// Pre-initialization script for SCIP WASM
// This runs before the main SCIP module initializes

Module['preRun'] = Module['preRun'] || [];
Module['postRun'] = Module['postRun'] || [];

// Create virtual filesystem directories
Module['preRun'].push(function() {
    FS.mkdir('/problems');
    FS.mkdir('/solutions');
    FS.mkdir('/settings');
});

// Capture stdout/stderr
Module['print'] = function(text) {
    if (Module['onStdout']) {
        Module['onStdout'](text);
    } else {
        console.log('[SCIP]', text);
    }
};

Module['printErr'] = function(text) {
    if (Module['onStderr']) {
        Module['onStderr'](text);
    } else {
        console.error('[SCIP Error]', text);
    }
};

// Exit handler
Module['onExit'] = function(code) {
    if (Module['onExitCallback']) {
        Module['onExitCallback'](code);
    }
};
