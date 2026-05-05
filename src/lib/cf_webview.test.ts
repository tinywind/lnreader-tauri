import { describe, expect, it } from "vitest";
import {
  CF_CHALLENGE_PATTERN,
  isCloudflareChallenge,
} from "./cf_webview";

describe("isCloudflareChallenge", () => {
  it("matches the 'Just a moment...' interstitial title", () => {
    expect(
      isCloudflareChallenge(
        "<html><head><title>Just a moment...</title></head></html>",
      ),
    ).toBe(true);
  });

  it("matches the cf_chl_opt JS bootstrap variable", () => {
    expect(
      isCloudflareChallenge("<script>window.cf_chl_opt = {};</script>"),
    ).toBe(true);
  });

  it("matches the /cdn-cgi/challenge-platform/ asset path", () => {
    expect(
      isCloudflareChallenge(
        '<script src="/cdn-cgi/challenge-platform/h/g/cv">',
      ),
    ).toBe(true);
  });

  it("matches the cf-mitigated header marker", () => {
    expect(isCloudflareChallenge("...cf-mitigated: challenge...")).toBe(
      true,
    );
  });

  it("returns false for a normal page body", () => {
    expect(
      isCloudflareChallenge(
        "<html><body><h1>Welcome</h1><p>nothing to see here</p></body></html>",
      ),
    ).toBe(false);
  });

  it("returns false for an empty body", () => {
    expect(isCloudflareChallenge("")).toBe(false);
  });
});

describe("CF_CHALLENGE_PATTERN", () => {
  it("is consistent across repeated test() calls (no /g lastIndex drift)", () => {
    const body = "Just a moment...";
    expect(CF_CHALLENGE_PATTERN.test(body)).toBe(true);
    expect(CF_CHALLENGE_PATTERN.test(body)).toBe(true);
    expect(CF_CHALLENGE_PATTERN.test(body)).toBe(true);
  });
});
