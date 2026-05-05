import { invoke } from "@tauri-apps/api/core";

export interface CfCookie {
  name: string;
  value: string;
  domain: string | null;
  path: string | null;
}

export interface CfSolveResult {
  final_url: string;
  cookies: CfCookie[];
}

/**
 * CF challenge detection regex from `docs/plugins/cloudflare-bypass.md §6`.
 *
 * Matches well-known markers in the challenge HTML body so callers
 * can decide whether to retry the original fetch via `solveCloudflare`.
 */
export const CF_CHALLENGE_PATTERN =
  /Just a moment\.\.\.|cf_chl_opt|challenge-platform|cf-mitigated/;

/**
 * Returns true if `body` looks like a Cloudflare challenge page.
 * Caller is expected to also check status (403 / 503) and content type.
 */
export function isCloudflareChallenge(body: string): boolean {
  return CF_CHALLENGE_PATTERN.test(body);
}

/**
 * Hand off to the hidden Rust-side WebView to clear a Cloudflare
 * challenge for `url`. Resolves with the final URL and cookies set
 * by Cloudflare (notably `cf_clearance`).
 *
 * Throws if the challenge isn't cleared within the controller's
 * timeout (30 s on the Rust side).
 */
export async function solveCloudflare(url: string): Promise<CfSolveResult> {
  return invoke<CfSolveResult>("cf_solve", { url });
}
