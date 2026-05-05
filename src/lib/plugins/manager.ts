import {
  deleteInstalledPlugin,
  listInstalledPlugins,
  upsertInstalledPlugin,
} from "../../db/queries/installed-plugin";
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
   * Download `item.url`, sandbox-load it, register the result keyed
   * by the loaded plugin's `id`, and persist the source to DB so
   * the next app start rehydrates it without re-fetching. Throws if
   * the loaded plugin's `id` doesn't match `item.id`.
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
    // Some plugin sources (e.g. Komga) only set `id`/`name`/
    // `version`/`site` on the loaded instance and rely on the
    // repository index for `lang`/`iconUrl`. Fall back to the
    // index entry so the DB UPSERT never sees null for NOT NULL
    // columns (otherwise SQLite trips on
    // `installed_plugin.lang NOT NULL constraint`).
    await upsertInstalledPlugin({
      id: plugin.id,
      name: plugin.name ?? item.name,
      site: plugin.site ?? item.site,
      lang: plugin.lang ?? item.lang,
      version: plugin.version ?? item.version,
      iconUrl: plugin.iconUrl ?? item.iconUrl,
      sourceUrl: item.url,
      sourceCode: source,
    });
    return plugin;
  }

  /**
   * Rehydrate every previously-installed plugin from the DB by
   * sandbox-loading its stored source. Called once at app start.
   * Failures per plugin are logged via console.warn; the rest still
   * load so a single broken plugin never blocks startup.
   */
  async loadInstalledFromDb(): Promise<void> {
    const rows = await listInstalledPlugins();
    for (const row of rows) {
      try {
        const plugin = loadPlugin(row.sourceCode, {
          resolveRequire: createShimResolver(row.id),
        });
        this.installed.set(plugin.id, plugin);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[PluginManager] failed to reload '${row.id}' from DB:`,
          error,
        );
      }
    }
  }

  getPlugin(id: string): Plugin | undefined {
    return this.installed.get(id);
  }

  uninstallPlugin(id: string): boolean {
    const removed = this.installed.delete(id);
    if (removed) {
      void deleteInstalledPlugin(id).catch((error: unknown) => {
        // eslint-disable-next-line no-console
        console.warn(
          `[PluginManager] failed to delete '${id}' from DB:`,
          error,
        );
      });
    }
    return removed;
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
