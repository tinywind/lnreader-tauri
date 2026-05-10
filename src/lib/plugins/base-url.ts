import type { Plugin } from "./types";

export function getPluginBaseUrl(
  plugin: Pick<Plugin, "id" | "getBaseUrl">,
): string {
  let value: unknown;
  try {
    value = plugin.getBaseUrl();
  } catch (error) {
    throw new Error(`Plugin '${plugin.id}' failed to provide a base URL.`, {
      cause: error,
    });
  }

  if (typeof value !== "string") {
    throw new Error(`Plugin '${plugin.id}' returned a non-string base URL.`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Plugin '${plugin.id}' returned an empty base URL.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(`Plugin '${plugin.id}' returned an invalid base URL.`, {
      cause: error,
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Plugin '${plugin.id}' base URL must use http or https.`,
    );
  }

  return parsed.href;
}
