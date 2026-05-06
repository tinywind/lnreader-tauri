import {
  deleteInstalledPlugin,
  listInstalledPlugins,
  upsertInstalledPlugin,
} from "../../db/queries/installed-plugin";
import {
  appFetchText,
  createPluginFetchShim,
} from "../http";
import { clearPluginInputValues } from "./inputs";
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

function withPluginMetadata(plugin: Plugin, item: PluginItem): Plugin {
  const target = plugin as Plugin & Partial<PluginItem>;
  target.id = typeof target.id === "string" ? target.id : item.id;
  target.name = typeof target.name === "string" ? target.name : item.name;
  target.site = typeof target.site === "string" ? target.site : item.site;
  target.lang = typeof target.lang === "string" ? target.lang : item.lang;
  target.version =
    typeof target.version === "string" ? target.version : item.version;
  target.url = typeof target.url === "string" ? target.url : item.url;
  target.iconUrl =
    typeof target.iconUrl === "string" ? target.iconUrl : item.iconUrl;
  return plugin;
}

/**
 * Manages installed plugins for the running session.
 *
 * Plugins are kept in memory and persisted to SQLite. App startup
 * rehydrates installed plugin source from the DB without hitting
 * the repository network path.
 */
export class PluginManager {
  private readonly installed = new Map<string, Plugin>();
  private installedLoadPromise: Promise<void> | null = null;

  /**
   * Fetch a repository index URL and return the PluginItem[] list.
   * Drops malformed entries silently. Throws PluginValidationError
   * if the response isn't valid JSON or isn't an array.
   */
  async fetchRepository(repositoryUrl: string): Promise<PluginItem[]> {
    const text = await appFetchText(repositoryUrl);
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
    const source = await appFetchText(item.url);
    const plugin = withPluginMetadata(
      loadPlugin(source, {
        resolveRequire: createShimResolver(item.id, item.site),
        fetch: createPluginFetchShim(item.site),
      }),
      item,
    );
    if (plugin.id !== item.id) {
      throw new PluginValidationError(
        `Plugin id mismatch: repository index says '${item.id}', source says '${plugin.id}'.`,
      );
    }
    this.installed.set(plugin.id, plugin);
    // Some plugin sources (e.g. Komga) only set `id`/`name`/
    // `version`/`site` on the loaded instance and rely on the
    // repository index for `lang`/`iconUrl`. Fall back to the
    // index entry so runtime lists and the DB UPSERT never see null
    // for required metadata columns.
    await upsertInstalledPlugin({
      id: plugin.id,
      name: plugin.name,
      site: plugin.site,
      lang: plugin.lang,
      version: plugin.version,
      iconUrl: plugin.iconUrl,
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
    if (this.installedLoadPromise) {
      return this.installedLoadPromise;
    }
    const load = this.loadInstalledFromDbOnce().catch((error) => {
      this.installedLoadPromise = null;
      throw error;
    });
    this.installedLoadPromise = load;
    return load;
  }

  private async loadInstalledFromDbOnce(): Promise<void> {
    const rows = await listInstalledPlugins();
    for (const row of rows) {
      try {
        const plugin = withPluginMetadata(
          loadPlugin(row.sourceCode, {
            resolveRequire: createShimResolver(row.id, row.site),
            fetch: createPluginFetchShim(row.site),
          }),
          {
            id: row.id,
            name: row.name,
            site: row.site,
            lang: row.lang,
            version: row.version,
            iconUrl: row.iconUrl,
            url: row.sourceUrl,
          },
        );
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
      clearPluginInputValues(id);
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
