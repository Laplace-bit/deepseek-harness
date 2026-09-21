/** Browser placeholder for the Node-only internal module probe in Harness. */
export function createRequire(): never {
  throw new Error('Node module loading is unavailable in the embedded browser runtime')
}

export function isBuiltin(): boolean {
  return false
}
