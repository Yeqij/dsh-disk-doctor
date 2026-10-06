/**
 * Resolver hooks that redirect the two `@deepseek-ai/*` runtime peers to test
 * stubs, so `lib/index.js` can be loaded without a DSH host or installed peers.
 */
const MAP = new Map([
  ['@deepseek-ai/dsh-tools', new URL('./dsh-tools-stub.mjs', import.meta.url).href],
  ['@deepseek-ai/schemastery', new URL('./schemastery-stub.mjs', import.meta.url).href]
])

export async function resolve (specifier, context, nextResolve) {
  const mapped = MAP.get(specifier)
  if (mapped !== undefined) return { url: mapped, shortCircuit: true }
  return nextResolve(specifier, context)
}
