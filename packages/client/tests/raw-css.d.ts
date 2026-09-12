/**
 * Ambient types for Vite's query-suffix imports, declared locally because the
 * workspace does not depend on `vite` directly — vitest brings its own.
 *
 * `?raw` is how the browser lanes load the shipped stylesheet as bytes: the
 * import resolves at bundling time to the file's exact text, so the lanes scan
 * the same stylesheet a host loads rather than a reconstructed copy.
 */
declare module '*.css?raw' {
  /** The exact on-disk bytes of the referenced stylesheet. */
  const content: string
  export default content
}
