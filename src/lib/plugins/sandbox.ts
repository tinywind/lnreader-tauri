import type { Plugin } from "./types";

/**
 * Whitelist of modules the sandboxed plugin code can `require()`.
 * Each entry returns the host's shim implementation. The default
 * resolver throws; callers must opt into specific modules.
 */
export type RequireResolver = (id: string) => unknown;

/**
 * Fetch shim signature. Plugins calling raw `fetch(url, init)` route
 * through this so every plugin HTTP call lands on the scraper
 * WebView-backed `webview_fetch` IPC instead of bare browser fetch.
 */
export type FetchShim = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface SandboxOptions {
  resolveRequire?: RequireResolver;
  /**
   * Override the `fetch` global the sandbox exposes to plugin code.
   * Defaults to `globalThis.fetch` when the host does not provide a
   * scraper-backed fetch shim.
   */
  fetch?: FetchShim;
}

export class PluginSandboxError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(
      cause === undefined
        ? message
        : `${message} (${
            cause instanceof Error ? cause.message : String(cause)
          })`,
    );
    this.name = "PluginSandboxError";
    this.cause = cause;
  }
}

interface ModuleScope {
  exports: { default?: Plugin } & Record<string, unknown>;
}

/**
 * Globals every CommonJS-shaped plugin may expect at module-init
 * time. `exports` aliases `module.exports`, and `__dirname` /
 * `__filename` are inert defaults so defensive checks do not throw.
 */
const SANDBOX_GLOBAL_NAMES = [
  "require",
  "module",
  "exports",
  "__dirname",
  "__filename",
  "fetch",
] as const;

type SandboxArgs = readonly [
  RequireResolver,
  ModuleScope,
  ModuleScope["exports"],
  string,
  string,
  FetchShim | undefined,
];

/**
 * Evaluate plugin source code in a sandbox-ish scope and return
 * the default export (the {@link Plugin} instance).
 *
 * The plugin source is evaluated as a CommonJS module. `require`
 * and `module.exports` are the only globals exposed at call time.
 * Real isolation lands later when this moves into a dedicated worker;
 * for now this is only suitable for community plugins fetched from a
 * known repository.
 */
export function loadPlugin(
  source: string,
  options: SandboxOptions = {},
): Plugin {
  const resolveRequire =
    options.resolveRequire ??
    ((id: string): unknown => {
      throw new PluginSandboxError(
        `Module '${id}' is not allowed in the plugin sandbox.`,
      );
    });

  const moduleScope: ModuleScope = { exports: {} };

  const fetchShim: FetchShim | undefined =
    options.fetch ??
    (typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis)
      : undefined);

  let evaluator: (...args: SandboxArgs) => void;
  try {
    evaluator = new Function(
      ...SANDBOX_GLOBAL_NAMES,
      source,
    ) as typeof evaluator;
  } catch (error) {
    throw new PluginSandboxError(
      "Plugin source failed to compile.",
      error,
    );
  }

  try {
    evaluator(
      resolveRequire,
      moduleScope,
      moduleScope.exports,
      "",
      "",
      fetchShim,
    );
  } catch (error) {
    throw new PluginSandboxError(
      "Plugin module threw during load.",
      error,
    );
  }

  const plugin = moduleScope.exports.default;
  if (!plugin) {
    throw new PluginSandboxError(
      "Plugin module did not assign module.exports.default.",
    );
  }
  return plugin;
}
