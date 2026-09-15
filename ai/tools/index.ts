/**
 * Tool registry entry point.
 *
 * Importing this module registers every tool exactly once. The orchestrator
 * imports from here so an agent can never reach a tool that was not registered
 * through the controlled path.
 */

import './talent-tools';
import './project-tools';
import './lifecycle-tools';

export * from './registry';
export * from './talent-tools';
export * from './project-tools';
export * from './lifecycle-tools';
