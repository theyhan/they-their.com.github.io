/**
 * Public surface of the metric core. Import from here rather than reaching into files, so the
 * single-definition-site rule in ADR-0003 stays enforceable by review.
 */

export * from './types.js';
export * from './registry.js';
export * from './formulas.js';
export * from './performance-index.js';
export * from './confidence.js';
