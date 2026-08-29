/**
 * Bundle entry for scripts/generate-tokens.mjs only. Re-exports the token object
 * and the CSS emitter so the generator can import both from a single bundle.
 * Not imported by application code.
 */
export { tokens } from './index';
export * as css from './css';
