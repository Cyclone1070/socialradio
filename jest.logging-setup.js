// Jest runs all unit specs with silence by default: services derive their
// pino level from LOG_LEVEL, and under jest we don't want their info/warn
// lines flooding the gate output. Logging specs pass an explicit level +
// stream override to LoggingModule.forRoot, so this does not mute them.
process.env.LOG_LEVEL ??= 'silent';