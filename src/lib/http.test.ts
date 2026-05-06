import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { pluginFetch, pluginFetchText } from "./http";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

function wireOk(
  body: string,
  overrides: Partial<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    finalUrl: string;
  }> = {},
): unknown {
  return {
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? "OK",
    bodyBase64: btoa(body),
    headers: overrides.headers ?? { "content-type": "text/plain" },
    finalUrl: overrides.finalUrl ?? "https://ok.test/",
  };
}

describe("pluginFetch", () => {
  it("forwards url + init to the webview_fetch IPC and rebuilds a Response", async () => {
    invokeMock.mockResolvedValueOnce(wireOk("hello"));

    const response = await pluginFetch("https://ok.test/", {
      method: "POST",
      headers: { "X-Custom": "1" },
      body: "payload",
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0]!;
    expect(command).toBe("webview_fetch");
    expect(args).toEqual({
      url: "https://ok.test/",
      init: {
        method: "POST",
        headers: expect.objectContaining({ "X-Custom": "1" }),
        body: "payload",
      },
      contextUrl: null,
    });

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("hello");
  });

  it("preserves binary response bodies from webview_fetch", async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      bodyBase64: "AP9QSwME",
      headers: { "content-type": "application/zip" },
      finalUrl: "https://ok.test/archive.zip",
    });

    const response = await pluginFetch("https://ok.test/archive.zip");

    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      0, 255, 80, 75, 3, 4,
    ]);
  });

  it("preserves the final URL on the rebuilt Response", async () => {
    invokeMock.mockResolvedValueOnce(
      wireOk("redirected", { finalUrl: "https://ok.test/after-redirect" }),
    );

    const response = await pluginFetch("https://ok.test/before");
    expect(response.url).toBe("https://ok.test/after-redirect");
  });

  it("forwards the optional scraper context URL", async () => {
    invokeMock.mockResolvedValueOnce(wireOk("hello"));

    await pluginFetch("https://ok.test/path", {
      contextUrl: "https://ok.test",
    });

    expect(invokeMock).toHaveBeenCalledWith("webview_fetch", {
      url: "https://ok.test/path",
      init: {
        headers: undefined,
        method: undefined,
        body: undefined,
      },
      contextUrl: "https://ok.test",
    });
  });

  it("surfaces non-2xx status as a Response with ok=false", async () => {
    invokeMock.mockResolvedValueOnce(
      wireOk("not found", { status: 404, statusText: "Not Found" }),
    );

    const response = await pluginFetch("https://ok.test/missing");
    expect(response.ok).toBe(false);
    expect(response.status).toBe(404);
  });

  it("propagates an IPC rejection so the global toast can fire", async () => {
    invokeMock.mockRejectedValueOnce(new Error("scraper not ready"));
    await expect(pluginFetch("https://ok.test/")).rejects.toThrow(
      "scraper not ready",
    );
  });
});

describe("pluginFetchText", () => {
  it("returns the body text on a 2xx response", async () => {
    invokeMock.mockResolvedValueOnce(wireOk("body"));
    expect(await pluginFetchText("https://ok.test/")).toBe("body");
  });

  it("throws on a non-2xx response with a status-aware message", async () => {
    invokeMock.mockResolvedValueOnce(
      wireOk("nope", { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(pluginFetchText("https://ok.test/")).rejects.toThrow(
      /HTTP 503 Service Unavailable on https:\/\/ok\.test\//,
    );
  });
});
