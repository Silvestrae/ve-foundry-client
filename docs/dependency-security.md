# Dependency security update — 2026-11-13

Updated Electron 41.10.6 to 43.8.10, Vite 7.3.5 to 7.3.8, Zod 4.3.6 to 4.6.7, fast-uri 3.1.8 to 3.1.9, ip-address 10.7.1 to 10.7.6, and the existing Undici resolutions to 6.29.1 and 7.30.2. The application version remains unchanged pending the release decision.

Electron 43 is a supported release line at review time. Electron 42.11.18 fixes the reported advisories but is out of support; Electron 44 removes macOS 12 support. The Electron 42/43 breaking-change review found no use of the removed storage-quota option, affected offscreen capture APIs or native notification API. Desktop behavior on macOS and Linux still needs platform acceptance.

The recursive npm audit fell from 34 vulnerability entries (29 distinct advisories) to two medium advisories. No high or critical advisories remain in that audit. The updated versions address 31 of the 32 previously open GitHub alerts, plus the additional Zod advisory. Remote alerts are not cleared until the changed lockfile reaches the default branch and GitHub rescans it.

## Remaining build-tool advisories

- [glob GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4): glob 10.5.0 enters through the optional fsevents/node-gyp/make-fetch-happen/cacache dependency chain. The fixed glob 14 major lies outside cacache 19's declared range. Current upstream node-gyp/make-fetch-happen updates still lead to affected glob majors. Revisit when a compatible consumer chain adopts the fix.
- [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): versions 9.0.9 and 10.2.6 are used by linting and packaging tools. The fixed version 11.0.1 changes the matching API, removes methods, and changes the representation of Minimatch.set. Electron Builder inspects that representation. Current upstream Electron Builder and TypeScript ESLint releases still declare affected minimatch majors. Do not apply a global major override without validating these consumers.

Neither package is included in the inspected Windows app.asar. These findings remain visible and were not dismissed or suppressed. A maintained backport is possible but was not introduced as part of this dependency refresh. Five deprecation notices remain separate from vulnerability findings.

## Validation

Passed on Windows with Electron 43.8.10:

- Immutable Yarn installation, TypeScript checking, ESLint, and production build.
- All 14 Chromium login compatibility cases.
- World-loading lifecycle, sizing, elapsed time, dismissal, layout, background, completion and injection checks.
- Updater callback/IPC/state checks and detached-window routing/lifecycle checks for seven profiles.
- Windows x64 directory packaging; archive inspection confirms Undici 6.29.1 and the rebuilt Zod renderer bundle, with glob, minimatch, Vite, fast-uri and ip-address absent.
- Packaged desktop startup using isolated application data, declining legacy-settings import, opening and saving client settings, and creating/closing a second launcher window.

Build warnings about Zod pure annotations and runtime stylesheet references remain visible. Yarn's transitive peer notice remains visible. These did not fail validation. The initial directory-only package lacked app-update.yml; updater failure for that package was correctly displayed instead of crashing. Installer packaging and the updater metadata check are recorded separately below.

No hosted Foundry world, native gameplay, macOS runtime or Linux runtime was tested. Login and loading checks use the project's Chromium fixtures. The desktop test used the packaged executable, not a browser substitute.

Windows x64 NSIS packaging also passed with publishing disabled and executable signing disabled for this local candidate. The generated app-update.yml names the existing GitHub repository. After relaunching the completed package, its network update check succeeded and correctly reported that 1.0.36 was current. The isolated settings survived restart and the legacy-import prompt did not reappear. The installer was built but not installed over the user's installation.

The peer warnings identify the existing VueUse/vue-demi Vue peer declarations and the optional electron-builder-squirrel-windows peer in Electron Builder/dmg-builder. No dependency override or warning suppression was added for those notices.

---

# Dependency security update — 2026-10-14

The dependency update addresses the versions flagged by 38 of the 39 open Dependabot alerts at the time of review. The remaining alert is described below; it has not been suppressed or dismissed.

## Updated dependencies

Electron moves from 41.10.3 to 41.10.6, and Vue and its matching compiler/runtime packages move from 3.5.27 to 3.5.44. Both stay on the existing release line. No Foundry integration code, login selectors, settings formats, or application version changes are included.

Transitive updates cover `@humanfs/node`, `@xmldom/xmldom`, all installed `brace-expansion` release lines, `fast-uri`, `ip-address`, `js-yaml`, `shell-quote`, `source-map-js`, and `undici`. Undici resolutions preserve the major version requested by each consumer: 6.28.1 for version 6 consumers and 7.29.1 for the version 7 Electron download tool.

`http-cache-semantics` moves from 4.2.0 to the compatible 4.3.0 release, outside the advisory's affected version range. This is not a verified fix to the reported cache behavior: [the maintainer disputes the advisory](https://github.com/kornelski/http-cache-semantics/issues/56). In this project it belongs to dependency download/build tooling, not the Foundry HTTP client or a shared response cache.

## Remaining advisory

[`sprintf-js` GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) still flags 1.1.3, the latest published version. There is no upstream patched release.

The dependency path is `electron-builder` → `app-builder-lib` → `@electron/get` 3 → optional `global-agent` → `roarr` → `sprintf-js`. It is build-time proxy logging, with no project source imports. Electron 41's own downloader uses `@electron/get` 5 and does not depend on this chain.

Inspection of the newly packaged Windows application's `app.asar` confirmed that `sprintf-js`, `global-agent`, and `http-cache-semantics` are absent.

The authoritative [CVE record for CVE-2026-97058](https://www.cve.org/CVERecord?id=CVE-2026-97058) reports `REJECTED`; its rejection timestamp is 2026-10-12T19:33:32Z. The [upstream discussion](https://github.com/alexei/sprintf.js/issues/237) disputes treating invalid numeric format precision as a vulnerability. GitHub/npm still report the advisory at the time of this check. The package remains unchanged rather than introducing an incompatible override or a local fork solely to silence the scanner.

Yarn also reports deprecation notices for existing tooling packages. These are distinct from security advisories and were not hidden.

## Compatibility validation

The following checks passed with the updated dependencies on Windows:

- Immutable Yarn installation, TypeScript checking, ESLint, and production build.
- All 14 Chromium login compatibility fixtures, covering legacy dropdown/text-input layouts, current Foundry v14 layouts, saved user IDs, administrator authentication, and autofill without submission.
- World-loading lifecycle, readiness fallback, hosted-service exclusion, dismissal, timing, rendering, and input-escaping tests.
- Updater state, schema, production callbacks, and IPC regression tests.
- Electron Builder Windows x64 directory packaging with publishing disabled.

These checks preserve regression coverage for the existing Foundry v13+ integration. They do not constitute live testing of licensed Foundry v13/v14 servers, game systems, or third-party modules. Linux and macOS packaging have not been run locally.
