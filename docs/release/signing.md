# Code Signing & Auto-Update

> Sprint 6 deliverable. The auto-update flow chosen for v0.1
> (`@tauri-apps/plugin-updater` on desktop) requires signed
> manifests; this doc collects the certificate, key, and CI plumbing
> decisions so the actual signing setup is mechanical when Sprint 6
> arrives.

## 1. Channels in scope

| Platform | Channel | Notes |
|---|---|---|
| Windows | GitHub Releases via `tauri-plugin-updater` | Code-signing certificate **required** to avoid SmartScreen warnings. |
| macOS | GitHub Releases via `tauri-plugin-updater` | Apple Developer ID + notarization **required** to avoid Gatekeeper. |
| Linux | GitHub Releases via `tauri-plugin-updater` | GPG-signed AppImage / `.deb`; less strict but still recommended. |
| iOS | App Store + TestFlight | Apple Developer Program membership; in-app updater not used. |
| Android (Play) | Google Play Store | Play app signing; in-app updater not used. |
| Android (sideload) | GitHub Releases page link in More tab | No signing requirement beyond the project's debug keystore today. |

## 2. Certificate matrix and cost

| Cert / membership | Annual cost | Required for | Notes |
|---|---|---|---|
| Apple Developer Program | USD 99 | macOS Developer ID signing + notarization, iOS App Store & TestFlight | Single account covers both desktop macOS and iOS. |
| Windows code signing certificate (OV from a CA like Sectigo, DigiCert) | USD ~150–400 | Windows MSI / `.exe` signing | OV minimizes SmartScreen friction; EV (~USD 300+) eliminates it for new publishers. |
| Azure Trusted Signing (subscription) | USD ~10/month + per-signing fees | Windows code signing, alternative to a self-managed cert | Pay-as-you-go option; lower upfront cost. |
| GPG key for Linux packages | USD 0 | `.deb` / AppImage signing | Self-generated; publish public key in repo. |
| Google Play Developer | USD 25 (one-time) | Play Store distribution | Independent of signed-updater flow. |

## 3. Decisions to make before Sprint 6

- [ ] Apple Developer Program: enroll? **Required** if shipping macOS
      signed builds and iOS TestFlight/App Store. Decline = drop
      signed macOS desktop and iOS distribution from v0.1.
- [ ] Windows signing path: traditional cert vs Azure Trusted
      Signing. Decline = ship unsigned with SmartScreen warnings.
- [ ] Linux signing key: self-generated GPG. Default = yes.
- [ ] Google Play Developer: enroll? Decline = sideload-only Android.

If the budget answer to all the paid items is "no", the v0.1 release
ships **unsigned** on desktop with explicit README warnings about
SmartScreen / Gatekeeper. The auto-update flow then degrades to
"open GitHub Releases page in browser" for desktop too — same as
the Android-sideload fallback. `prd.md §11` lists this as a Medium
risk; this doc surfaces the decision to the maintainer.

## 4. Secret handling (when certs are obtained)

Certificate private keys go into GitHub Actions repository secrets,
never into the repo. The CI build step references them at the bundle
phase. Suggested secret names:

```
APPLE_TEAM_ID
APPLE_DEVELOPER_ID_APPLICATION_CERT_BASE64
APPLE_DEVELOPER_ID_APPLICATION_CERT_PASSWORD
APPLE_NOTARIZATION_USERNAME
APPLE_NOTARIZATION_PASSWORD
APPLE_NOTARIZATION_TEAM_ID
WINDOWS_PFX_BASE64
WINDOWS_PFX_PASSWORD
LINUX_GPG_PRIVATE_KEY_BASE64
LINUX_GPG_KEY_ID
TAURI_SIGNING_PRIVATE_KEY            # tauri-plugin-updater manifest signing
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

The `tauri.conf.json` `bundle.targets` block and platform-specific
`signingIdentity` / `certificateThumbprint` fields are populated
from these secrets at build time.

## 5. `tauri-plugin-updater` manifest

A separate signing key (Tauri's own minisign-style format, NOT the
OS code-signing cert) signs the **update manifest** — the JSON the
plugin fetches to know whether a new version exists. Generated once
via:

```
pnpm tauri signer generate -w ~/.tauri/lnreader-tauri.key
```

The public key is committed in `tauri.conf.json` under
`plugins.updater.pubkey`. The private key is the `TAURI_SIGNING_PRIVATE_KEY`
secret above.

## 6. CI hooks

Sprint 6 wires up:

- A GitHub Actions release workflow triggered on `v*.*.*` tags.
- Per-platform matrix: ubuntu-latest (Linux + Android), windows-latest
  (Windows), macos-latest (macOS + iOS).
- Each job calls `pnpm tauri build` with the secrets above injected,
  produces signed bundles, and uploads them as Release assets plus
  the `latest.json` manifest the updater reads.

## 7. References

- Tauri updater plugin: <https://v2.tauri.app/plugin/updater/>
- Apple Developer ID + notarization (Tauri): <https://v2.tauri.app/distribute/sign/macos/>
- Windows code signing (Tauri): <https://v2.tauri.app/distribute/sign/windows/>
- Linux signing recipes (Tauri): <https://v2.tauri.app/distribute/sign/linux/>
- Azure Trusted Signing: <https://learn.microsoft.com/en-us/azure/trusted-signing/overview>
