import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("./cf_webview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cf_webview")>();
  return {
    ...actual,
    solveCloudflare: vi.fn(),
  };
});

import { fetch as mockedRawFetch } from "@tauri-apps/plugin-http";
import { solveCloudflare } from "./cf_webview";
import { pluginFetch } from "./http";

const fetchMock = vi.mocked(mockedRawFetch);
const solveMock = vi.mocked(solveCloudflare);

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pluginFetch — happy path", () => {
  it("returns the first response when not a Cloudflare challenge", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("hello", { status: 200 }),
    );

    const response = await pluginFetch("https://ok.test/");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(solveMock).not.toHaveBeenCalled();
  });

  it("does NOT trigger the CF path on a non-html 403", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"forbidden"}', {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await pluginFetch("https://api.test/");

    expect(response.status).toBe(403);
    expect(solveMock).not.toHaveBeenCalled();
  });

  it("does NOT trigger the CF path on a 403 html that isn't a CF challenge", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<html><body>Forbidden</body></html>", 403),
    );

    const response = await pluginFetch("https://example.test/");

    expect(response.status).toBe(403);
    expect(solveMock).not.toHaveBeenCalled();
  });
});

describe("pluginFetch — CF retry", () => {
  it("solves the challenge and retries with the Cookie header on 503 + CF body", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        "<html><head><title>Just a moment...</title></head></html>",
        503,
      ),
    );
    solveMock.mockResolvedValueOnce({
      final_url: "https://protected.test/",
      cookies: [
        {
          name: "cf_clearance",
          value: "abc123",
          domain: ".protected.test",
          path: "/",
        },
        {
          name: "__cf_bm",
          value: "xyz",
          domain: ".protected.test",
          path: "/",
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await pluginFetch("https://protected.test/");

    expect(response.status).toBe(200);
    expect(solveMock).toHaveBeenCalledWith("https://protected.test/");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const retryCall = fetchMock.mock.calls[1]!;
    const headers = (retryCall[1] as { headers: Record<string, string> })
      .headers;
    expect(headers.Cookie).toBe("cf_clearance=abc123; __cf_bm=xyz");
  });

  it("triggers retry on 403 + CF challenge marker (cf_chl_opt)", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<script>window.cf_chl_opt={};</script>", 403),
    );
    solveMock.mockResolvedValueOnce({
      final_url: "https://protected.test/",
      cookies: [
        {
          name: "cf_clearance",
          value: "v",
          domain: null,
          path: null,
        },
      ],
    });
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await pluginFetch("https://protected.test/");

    expect(response.status).toBe(200);
    expect(solveMock).toHaveBeenCalledOnce();
  });

  it("propagates a solveCloudflare rejection", async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse("<title>Just a moment...</title>", 503),
    );
    solveMock.mockRejectedValueOnce(new Error("cf_solve: timeout"));

    await expect(pluginFetch("https://protected.test/")).rejects.toThrow(
      /cf_solve: timeout/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
