import type { Plugin } from "./types";

/**
 * Whitelist of modules the sandboxed plugin code can `require()`.
 * Each entry returns the host's shim implementation. The default
 * resolver throws — callers must opt into specific modules.
 */
export type RequireResolver = (id: string) => unknown;

export interface SandboxOptions {
  resolveRequire?: RequireResolver;
}

export class PluginSandboxError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PluginSandboxError";
    this.cause = cause;
  }
}

interface ModuleScope {
  exports: { default?: Plugin } & Record<string, unknown>;
}

/**
 * Evaluate plugin source code in a sandbox-ish scope and return
 * the default export (the {@link Plugin} instance).
 *
 * The plugin source is evaluated as a CommonJS module — `require`
 * and `module.exports` are the only globals exposed at call time.
 * Real isolation lands in Sprint 2 part 3b when this moves into a
 * dedicated Web Worker; for now the evaluator runs on the main
 * thread but with no implicit `window` / `document` access exposed
 * via this API (still reachable via tricks, so don't trust the
 * sandbox for adversarial input — only for community plugins
 * fetched from a known repository).
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

  let evaluator: (require: RequireResolver, module: ModuleScope) => void;
  try {
    evaluator = new Function(
      "require",
      "module",
      source,
    ) as typeof evaluator;
  } catch (error) {
    throw new PluginSandboxError(
      "Plugin source failed to compile.",
      error,
    );
  }

  try {
    evaluator(resolveRequire, moduleScope);
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
