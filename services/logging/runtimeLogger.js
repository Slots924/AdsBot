const fallback = {
    child() { return this; },
    debug() {},
    info() {},
    warn() {},
    error() {},
    runWithContext(_context, operation) { return operation(); },
};

let activeLogger = fallback;


function configureRuntimeLogger(logger) {
    activeLogger = logger?.child ? logger : fallback;
    return activeLogger;
}


function getLogger(scope, context) {
    return activeLogger.child(scope, context);
}


export { configureRuntimeLogger, getLogger };
