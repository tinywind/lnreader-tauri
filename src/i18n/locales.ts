export const SUPPORTED_APP_LOCALES = ["en", "ko"] as const;

export type AppLocale = (typeof SUPPORTED_APP_LOCALES)[number];

export function normalizeAppLocale(value: unknown): AppLocale {
  if (typeof value !== "string") return "en";

  const locale = value.trim().toLowerCase().replace("_", "-");
  if (locale === "ko" || locale.startsWith("ko-")) return "ko";
  return "en";
}
