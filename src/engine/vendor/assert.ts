/**
 * Browser-safe stand-in for `node:assert`'s strict export, used by the vendored
 * uma-skill-tools sources. Only the call forms the engine uses are provided.
 */
export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? 'assertion failed');
}
