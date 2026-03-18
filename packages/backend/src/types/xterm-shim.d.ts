/**
 * Type shim: @xterm/addon-serialize has a peer dependency on @xterm/xterm,
 * but the backend uses @xterm/headless (no DOM). Re-export the headless
 * types under the @xterm/xterm module name so addon type declarations resolve.
 */
declare module "@xterm/xterm" {
    export * from "@xterm/headless";
}
