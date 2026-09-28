/** Browser placeholder for the Node-only internal module probe in Harness.
 * @returns Never; browser code must not load Node modules.
 */
export function createRequire(): never {
  throw new Error('Node module loading is unavailable in the embedded browser runtime')
}

/** Report that no Node built-in module is available in the browser runtime.
 * @returns Always false.
 */
export function isBuiltin(): boolean {
  return false
}
