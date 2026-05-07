export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

export function isAndroidRuntime(): boolean {
  return (
    isTauriRuntime() &&
    typeof navigator !== "undefined" &&
    /\bAndroid\b/i.test(navigator.userAgent)
  );
}

export function isWindowsRuntime(): boolean {
  return (
    isTauriRuntime() &&
    typeof navigator !== "undefined" &&
    /\bWindows\b/i.test(navigator.userAgent)
  );
}
