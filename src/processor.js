'use strict';

// Delegate entirely to the AgentOrchestrator pipeline.
const orchestrator = require('./agents/orchestrator');

module.exports = { process: orchestrator.process };
