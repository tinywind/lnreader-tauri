import { invoke } from "@tauri-apps/api/core";
import { appFetch } from "./http";

const GITHUB_API_BASE = "https://api.github.com/repos/tinywind/norea";

export type UpdateChannel = "official" | "dev";
export type UpdateStatus = "newer" | "current" | "unknown";

export interface BuildInfo {
  buildChannel: string | null;
  buildTime: string | null;
  buildVersion: string | null;
  gitSha: string | null;
  githubRunAttempt: string | null;
  githubRunId: string | null;
  platform: string;
  targetArch: string;
  targetFamily: string;
  targetOs: string;
}

export interface UpdateCandidate {
  assetName: string;
  channel: UpdateChannel;
  displayName: string;
  downloadFileName: string;
  downloadUrl: string;
  remoteTime: string | null;
  remoteVersion: string | null;
  sourceUrl: string;
  status: UpdateStatus;
}

interface GitHubRelease {
  assets: GitHubReleaseAsset[];
  html_url: string;
  name: string | null;
  published_at: string | null;
  tag_name: string;
}

interface GitHubReleaseAsset {
  browser_download_url: string;
  name: string;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRun[];
}

interface GitHubWorkflowRun {
  conclusion: string | null;
  created_at: string;
  html_url: string;
  id: number;
  status: string | null;
  updated_at: string;
}

interface GitHubArtifactsResponse {
  artifacts: GitHubArtifact[];
}

interface GitHubArtifact {
  archive_download_url: string;
  expired: boolean;
  name: string;
}

interface WorkflowArtifactSelection {
  artifact: GitHubArtifact;
  downloadExtension: string | null;
}

interface AssetPreference {
  extensions?: string[];
  token: string;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function getBuildInfo(): Promise<BuildInfo> {
  return invoke<BuildInfo>("get_build_info");
}

export async function checkOfficialUpdate(
  buildInfo: BuildInfo,
): Promise<UpdateCandidate> {
  const release = await fetchGithubJson<GitHubRelease>(
    `${GITHUB_API_BASE}/releases/latest`,
  );
  const asset = selectReleaseAsset(release.assets, buildInfo.platform);
  if (!asset) {
    throw new Error(`No release asset matches ${buildInfo.platform}.`);
  }

  const remoteVersion = normalizeReleaseVersion(release.tag_name);
  return {
    assetName: asset.name,
    channel: "official",
    displayName: release.name?.trim() || release.tag_name,
    downloadFileName: asset.name,
    downloadUrl: asset.browser_download_url,
    remoteTime: release.published_at,
    remoteVersion,
    sourceUrl: release.html_url,
    status: compareReleaseBuild(buildInfo, remoteVersion, release.published_at),
  };
}

export async function checkDevUpdate(
  buildInfo: BuildInfo,
): Promise<UpdateCandidate> {
  const workflow = workflowForPlatform(buildInfo.platform);
  if (!workflow) {
    throw new Error(`No workflow matches ${buildInfo.platform}.`);
  }

  const runs = await fetchGithubJson<GitHubWorkflowRunsResponse>(
    `${GITHUB_API_BASE}/actions/workflows/${workflow}/runs?status=success&per_page=10`,
  );

  for (const run of runs.workflow_runs) {
    if (run.status !== "completed" || run.conclusion !== "success") {
      continue;
    }

    const artifacts = await fetchGithubJson<GitHubArtifactsResponse>(
      `${GITHUB_API_BASE}/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    const selection = selectWorkflowArtifact(
      artifacts.artifacts,
      buildInfo.platform,
    );
    if (!selection) {
      continue;
    }
    const { artifact, downloadExtension } = selection;

    return {
      assetName: artifact.name,
      channel: "dev",
      displayName: `#${run.id}`,
      downloadFileName: `${artifact.name}${downloadExtension ?? ".zip"}`,
      downloadUrl: artifact.archive_download_url,
      remoteTime: run.updated_at || run.created_at,
      remoteVersion: null,
      sourceUrl: run.html_url,
      status: compareWorkflowBuild(buildInfo, run),
    };
  }

  throw new Error(`No successful workflow artifact matches ${buildInfo.platform}.`);
}

export function installUpdate(candidate: UpdateCandidate): Promise<string> {
  return invoke<string>("download_and_open_update", {
    fileName: candidate.downloadFileName,
    url: candidate.downloadUrl,
  });
}

async function fetchGithubJson<T>(url: string): Promise<T> {
  const response = await appFetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned HTTP ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

function selectReleaseAsset(
  assets: readonly GitHubReleaseAsset[],
  platform: string,
): GitHubReleaseAsset | null {
  for (const preference of assetPreferences(platform)) {
    const asset = assets.find((item) => matchesPreference(item.name, preference));
    if (asset) return asset;
  }
  return null;
}

function selectWorkflowArtifact(
  artifacts: readonly GitHubArtifact[],
  platform: string,
): WorkflowArtifactSelection | null {
  for (const preference of assetPreferences(platform)) {
    const artifact = artifacts.find(
      (item) =>
        !item.expired &&
        item.name.toLowerCase().includes(preference.token.toLowerCase()),
    );
    if (artifact) {
      return {
        artifact,
        downloadExtension: preference.extensions?.[0] ?? null,
      };
    }
  }
  return null;
}

function assetPreferences(platform: string): AssetPreference[] {
  switch (platform) {
    case "windows-x64":
      return [
        { token: "norea-windows-x64-nsis", extensions: [".exe"] },
        { token: "norea-windows-x64-msi", extensions: [".msi"] },
      ];
    case "windows-arm64":
      return [
        { token: "norea-windows-arm64-nsis", extensions: [".exe"] },
        { token: "norea-windows-arm64-msi", extensions: [".msi"] },
      ];
    case "linux-x64":
      return [
        { token: "norea-linux-x64-appimage", extensions: [".appimage"] },
        { token: "norea-linux-x64-deb", extensions: [".deb"] },
        { token: "norea-linux-x64-rpm", extensions: [".rpm"] },
      ];
    case "linux-arm64":
      return [
        { token: "norea-linux-arm64-appimage", extensions: [".appimage"] },
        { token: "norea-linux-arm64-deb", extensions: [".deb"] },
        { token: "norea-linux-arm64-rpm", extensions: [".rpm"] },
      ];
    case "android-arm64":
      return [{ token: "norea-arm64", extensions: [".apk"] }];
    case "android-x86_64":
      return [{ token: "norea-x86_64", extensions: [".apk"] }];
    default:
      return [{ token: platform }];
  }
}

function matchesPreference(name: string, preference: AssetPreference): boolean {
  const lowerName = name.toLowerCase();
  if (!lowerName.includes(preference.token.toLowerCase())) {
    return false;
  }
  if (!preference.extensions) {
    return true;
  }
  return preference.extensions.some((extension) =>
    lowerName.endsWith(extension.toLowerCase()),
  );
}

function workflowForPlatform(platform: string): string | null {
  if (platform.startsWith("windows-")) return "windows.yml";
  if (platform.startsWith("linux-")) return "linux.yml";
  if (platform.startsWith("android-")) return "android.yml";
  return null;
}

function normalizeReleaseVersion(tagName: string): string | null {
  const match = tagName.trim().match(/^v?(\d+\.\d+(?:\.\d+)?)(?:[-+].*)?$/i);
  return match ? match[1] : null;
}

function compareReleaseBuild(
  buildInfo: BuildInfo,
  remoteVersion: string | null,
  remoteTime: string | null,
): UpdateStatus {
  const localVersion = parseSemver(buildInfo.buildVersion);
  const releaseVersion = parseSemver(remoteVersion);
  if (localVersion && releaseVersion) {
    return compareSemver(releaseVersion, localVersion) > 0 ? "newer" : "current";
  }

  return compareBuildTime(buildInfo.buildTime, remoteTime);
}

function compareWorkflowBuild(
  buildInfo: BuildInfo,
  run: GitHubWorkflowRun,
): UpdateStatus {
  if (buildInfo.githubRunId && buildInfo.githubRunId === String(run.id)) {
    return "current";
  }

  return compareBuildTime(buildInfo.buildTime, run.updated_at || run.created_at);
}

function compareBuildTime(
  localBuildTime: string | null,
  remoteBuildTime: string | null,
): UpdateStatus {
  if (!localBuildTime || !remoteBuildTime) {
    return "unknown";
  }

  const localTime = Date.parse(localBuildTime);
  const remoteTime = Date.parse(remoteBuildTime);
  if (!Number.isFinite(localTime) || !Number.isFinite(remoteTime)) {
    return "unknown";
  }

  return remoteTime > localTime ? "newer" : "current";
}

function parseSemver(version: string | null): Semver | null {
  if (!version) return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/i);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] ? Number(match[3]) : 0,
  };
}

function compareSemver(left: Semver, right: Semver): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
