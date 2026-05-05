import { onOpenUrl } from "@tauri-apps/plugin-deep-link";

export type DeepLink =
  | { kind: "repo-add"; repoUrl: string }
  | { kind: "unknown"; raw: string };

export function parseDeepLink(raw: string): DeepLink {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: "unknown", raw };
  }
  if (url.protocol !== "lnreader:") {
    return { kind: "unknown", raw };
  }
  if (url.host === "repo" && url.pathname === "/add") {
    const repoUrl = url.searchParams.get("url");
    if (repoUrl && repoUrl.trim() !== "") {
      return { kind: "repo-add", repoUrl: repoUrl.trim() };
    }
  }
  return { kind: "unknown", raw };
}

export interface DeepLinkHandlers {
  onRepoAdd: (repoUrl: string) => void;
  onUnknown?: (raw: string) => void;
}

/**
 * Subscribe to OS-level deep-link openings (URI scheme `lnreader://`).
 *
 * Returns an unlisten function suitable for cleanup in a React effect.
 * Errors during plugin invocation propagate so the caller decides
 * whether to log or ignore.
 */
export async function startDeepLinkListener(
  handlers: DeepLinkHandlers,
): Promise<() => void> {
  const unlisten = await onOpenUrl((urls) => {
    for (const raw of urls) {
      const parsed = parseDeepLink(raw);
      switch (parsed.kind) {
        case "repo-add":
          handlers.onRepoAdd(parsed.repoUrl);
          break;
        case "unknown":
          handlers.onUnknown?.(parsed.raw);
          break;
      }
    }
  });
  return unlisten;
}
