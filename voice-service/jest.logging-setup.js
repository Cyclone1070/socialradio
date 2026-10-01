// Test-time silence: fetcher services default to pino at LOG_LEVEL, so
// specs that don't inject a logger would otherwise dump JSON lines into
// the gate output. Specs that DO assert on logs inject explicit loggers.
process.env.LOG_LEVEL ??= 'silent';