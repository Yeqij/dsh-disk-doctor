/**
 * Test-only stand-in for `@deepseek-ai/dsh-tools`.
 *
 * It enforces the same structural invariants the real `defineTool` enforces before
 * it compiles schemas, so a malformed definition fails here too. The real package
 * additionally compiles the schema DSL and validates model arguments; that part is
 * exercised by installing the plugin into a DSH profile.
 */
export function defineTool (options) {
  if (typeof options?.name !== 'string' || options.name === '') throw new Error('defineTool: name is required')
  if (typeof options.description !== 'string' || options.description === '') throw new Error('defineTool: description is required')
  if (typeof options.execute !== 'function') throw new Error('defineTool: execute is required')
  if (options.parameters === undefined || typeof options.parameters !== 'object') throw new Error('defineTool: parameters is required')
  if (options.output === undefined || options.output.schema === undefined) throw new Error('defineTool: output.schema is required')
  if (typeof options.output.render !== 'function') throw new Error('defineTool: output.render is required')
  return { ...options }
}
