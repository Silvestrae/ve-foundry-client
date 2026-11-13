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
