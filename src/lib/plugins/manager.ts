import { pluginFetchText } from "../http";
import { loadPlugin } from "./sandbox";
import { createShimResolver } from "./shims";
import type { Plugin, PluginItem } from "./types";

export class PluginValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginValidationError";
  }
}

/**
 * Type-guard for the loose JSON shape upstream `repository.json`
 * indexes carry. We only require the fields the host actually
 * uses; any extras pass through.
 */
export function isValidPluginItem(value: unknown): value is PluginItem {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.url === "string" &&
    typeof v.site === "string" &&
    typeof v.lang === "string" &&
    typeof v.version === "string" &&
    typeof v.iconUrl === "string"
  );
}

/**
 * Manages installed plugins for the running session.
 *
 * v0.1 keeps plugins in memory only — restarting the app
 * re-fetches from the repository on demand. Disk persistence
 * (`tauri-plugin-fs`) lands in Sprint 2 part 3d.
 */
export class PluginManager {
  private readonly installed = new Map<string, Plugin>();

  /**
   * Fetch a repository index URL and return the PluginItem[] list.
   * Drops malformed entries silently. Throws PluginValidationError
   * if the response isn't valid JSON or isn't an array.
   */
  async fetchRepository(repositoryUrl: string): Promise<PluginItem[]> {
    const text = await pluginFetchText(repositoryUrl);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new PluginValidationError(
        `Repository ${repositoryUrl} returned invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new PluginValidationError(
        `Repository ${repositoryUrl} did not return a JSON array.`,
      );
    }
    return parsed.filter(isValidPluginItem);
  }

  /**
   * Download `item.url`, sandbox-load it, and register the result
   * keyed by the loaded plugin's `id`. Throws if the loaded
   * plugin's `id` doesn't match `item.id`.
   */
  async installPlugin(item: PluginItem): Promise<Plugin> {
    const source = await pluginFetchText(item.url);
    const plugin = loadPlugin(source, {
      resolveRequire: createShimResolver(item.id),
    });
    if (plugin.id !== item.id) {
      throw new PluginValidationError(
        `Plugin id mismatch — repository index says '${item.id}', source says '${plugin.id}'.`,
      );
    }
    this.installed.set(plugin.id, plugin);
    return plugin;
  }

  getPlugin(id: string): Plugin | undefined {
    return this.installed.get(id);
  }

  uninstallPlugin(id: string): boolean {
    return this.installed.delete(id);
  }

  list(): Plugin[] {
    return [...this.installed.values()];
  }

  has(id: string): boolean {
    return this.installed.has(id);
  }

  size(): number {
    return this.installed.size;
  }
}

/** Process-global singleton for the running session. */
export const pluginManager = new PluginManager();
