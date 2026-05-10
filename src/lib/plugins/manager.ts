import {
  deleteInstalledPlugin,
  listInstalledPlugins,
  upsertInstalledPlugin,
} from "../../db/queries/installed-plugin";
import {
  appFetchText,
  createPluginFetchShim,
} from "../http";
import type { ScraperExecutorId } from "../tasks/scraper-queue";
import { getPluginBaseUrl } from "./base-url";
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

const REQUIRED_PLUGIN_METADATA_FIELDS = [
  "id",
  "name",
  "lang",
  "version",
] as const;

const REQUIRED_PLUGIN_METHOD_FIELDS = [
  "popularNovels",
  "parseNovel",
  "parseChapter",
  "searchNovels",
  "getBaseUrl",
] as const;

const LOCAL_PLUGIN_LANGUAGE = "multi";

function readRequiredPluginString(
  value: unknown,
  field: string,
  sourceLabel: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PluginValidationError(
      `Plugin ${sourceLabel} is missing required string field '${field}'.`,
    );
  }
  return value;
}

function readOptionalPluginString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : undefined;
}

function assertPluginContract(plugin: Plugin, sourceLabel: string): void {
  const value = plugin as unknown as Record<string, unknown>;
  for (const field of [...REQUIRED_PLUGIN_METADATA_FIELDS, "url"] as const) {
    readRequiredPluginString(value[field], field, sourceLabel);
  }
  if (typeof value.iconUrl !== "string") {
    throw new PluginValidationError(
      `Plugin ${sourceLabel} is missing required string field 'iconUrl'.`,
    );
  }
  for (const field of REQUIRED_PLUGIN_METHOD_FIELDS) {
    if (typeof value[field] !== "function") {
      throw new PluginValidationError(
        `Plugin ${sourceLabel} is missing required function '${field}'.`,
      );
    }
  }
}

function pluginItemFromLocalSource(
  plugin: Plugin,
  sourceUrl: string,
): PluginItem {
  const value = plugin as unknown as Record<string, unknown>;
  return {
    id: readRequiredPluginString(value.id, "id", sourceUrl),
    name: readRequiredPluginString(value.name, "name", sourceUrl),
    lang: readOptionalPluginString(value.lang) ?? LOCAL_PLUGIN_LANGUAGE,
    version: readRequiredPluginString(value.version, "version", sourceUrl),
    url: sourceUrl,
    iconUrl: readOptionalPluginString(value.iconUrl) ?? "",
  };
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
    typeof v.lang === "string" &&
    typeof v.version === "string" &&
    typeof v.iconUrl === "string"
  );
}

function withPluginMetadata(plugin: Plugin, item: PluginItem): Plugin {
  const target = plugin as Plugin & Partial<PluginItem>;
  target.id = typeof target.id === "string" ? target.id : item.id;
  target.name = typeof target.name === "string" ? target.name : item.name;
  target.lang = typeof target.lang === "string" ? target.lang : item.lang;
  target.version =
    typeof target.version === "string" ? target.version : item.version;
  target.url = typeof target.url === "string" ? target.url : item.url;
  target.iconUrl =
    typeof target.iconUrl === "string" ? target.iconUrl : item.iconUrl;
  return plugin;
}

function pluginItemFromPlugin(plugin: Plugin, sourceUrl: string): PluginItem {
  return {
    id: plugin.id,
    name: plugin.name,
    lang: plugin.lang,
    version: plugin.version,
    iconUrl: plugin.iconUrl,
    url: sourceUrl,
  };
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
  private readonly installedSources = new Map<
    string,
    { item: PluginItem; source: string }
  >();
  private readonly executorRuntimes = new Map<string, Plugin>();
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
    const plugin = this.loadRuntimePlugin(source, item, "immediate");
    if (plugin.id !== item.id) {
      throw new PluginValidationError(
        `Plugin id mismatch: repository index says '${item.id}', source says '${plugin.id}'.`,
      );
    }
    await this.registerInstalledPlugin(plugin, item.url, source);
    return plugin;
  }

  /**
   * Install a local plugin source file. Repository-only metadata is
   * synthesized when absent, but the runtime methods must be present
   * before the plugin is persisted.
   */
  async installPluginFromSource(
    source: string,
    sourceUrl: string,
  ): Promise<Plugin> {
    const item = pluginItemFromLocalSource(
      loadPlugin(source, {
        resolveRequire: createShimResolver(
          sourceUrl,
          undefined,
          "immediate",
        ),
        fetch: createPluginFetchShim(
          undefined,
          undefined,
          "immediate",
        ),
      }),
      sourceUrl,
    );
    const plugin = this.loadRuntimePlugin(source, item, "immediate");
    await this.registerInstalledPlugin(plugin, sourceUrl, source);
    return plugin;
  }

  private loadRuntimePlugin(
    source: string,
    item: PluginItem,
    executor: ScraperExecutorId,
  ): Plugin {
    let plugin: Plugin | undefined;
    const baseUrl = () => {
      if (!plugin) {
        throw new PluginValidationError(
          `Plugin '${item.id}' accessed its base URL during module load.`,
        );
      }
      return getPluginBaseUrl(plugin);
    };
    plugin = withPluginMetadata(
      loadPlugin(source, {
        resolveRequire: createShimResolver(item.id, baseUrl, executor),
        fetch: createPluginFetchShim(baseUrl, item.id, executor),
      }),
      item,
    );
    assertPluginContract(plugin, item.url);
    try {
      getPluginBaseUrl(plugin);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `Plugin '${item.id}' returned an invalid base URL.`;
      throw new PluginValidationError(message);
    }
    return plugin;
  }

  private async registerInstalledPlugin(
    plugin: Plugin,
    sourceUrl: string,
    source: string,
  ): Promise<void> {
    this.installed.set(plugin.id, plugin);
    this.installedSources.set(plugin.id, {
      item: pluginItemFromPlugin(plugin, sourceUrl),
      source,
    });
    this.clearExecutorRuntimes(plugin.id);
    await upsertInstalledPlugin({
      id: plugin.id,
      name: plugin.name,
      lang: plugin.lang,
      version: plugin.version,
      iconUrl: plugin.iconUrl,
      sourceUrl,
      sourceCode: source,
    });
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

  async reloadInstalledFromDb(): Promise<void> {
    this.installedLoadPromise = null;
    this.installed.clear();
    this.installedSources.clear();
    this.executorRuntimes.clear();
    await this.loadInstalledFromDb();
  }

  private async loadInstalledFromDbOnce(): Promise<void> {
    const rows = await listInstalledPlugins();
    for (const row of rows) {
      try {
        const item = {
          id: row.id,
          name: row.name,
          lang: row.lang,
          version: row.version,
          iconUrl: row.iconUrl,
          url: row.sourceUrl,
        };
        const plugin = this.loadRuntimePlugin(
          row.sourceCode,
          item,
          "immediate",
        );
        this.installed.set(plugin.id, plugin);
        this.installedSources.set(plugin.id, {
          item,
          source: row.sourceCode,
        });
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

  getPluginForExecutor(id: string, executor: ScraperExecutorId): Plugin {
    const base = this.installed.get(id);
    if (!base) {
      throw new PluginValidationError(`Plugin '${id}' is not installed.`);
    }
    if (executor === "immediate") return base;

    const runtimeKey = `${executor}:${id}`;
    const cached = this.executorRuntimes.get(runtimeKey);
    if (cached) return cached;

    const installed = this.installedSources.get(id);
    if (!installed) return base;

    const plugin = this.loadRuntimePlugin(
      installed.source,
      installed.item,
      executor,
    );
    this.executorRuntimes.set(runtimeKey, plugin);
    return plugin;
  }

  async uninstallPlugin(id: string): Promise<boolean> {
    if (!this.installed.has(id)) return false;
    try {
      await deleteInstalledPlugin(id);
    } catch (error) {
      throw new Error(
        `Failed to delete installed plugin '${id}' during uninstall.`,
        { cause: error },
      );
    }
    this.installed.delete(id);
    this.installedSources.delete(id);
    this.clearExecutorRuntimes(id);
    clearPluginInputValues(id);
    return true;
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

  private clearExecutorRuntimes(pluginId: string): void {
    for (const key of [...this.executorRuntimes.keys()]) {
      if (key.endsWith(`:${pluginId}`)) this.executorRuntimes.delete(key);
    }
  }
}

/** Process-global singleton for the running session. */
export const pluginManager = new PluginManager();
