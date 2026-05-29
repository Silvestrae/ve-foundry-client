# Changelog

All notable VE Foundry Client changes are tracked here from `1.0.0` onward.

## 1.0.23 - 2026-05-29

### Fixed

- Fixed duplicate server entries with the same Foundry URL sharing the first entry's automatic login and autorun settings.

## 1.0.22 - 2026-05-20

### Changed

- Improved unavailable-server handling so failed server loads return to the server select screen and show a themed modal with the server host and failure reason.
- Updated the shared prompt modal styling to follow the current theme colours more closely.
- Kept the server select screen visible behind fallback prompts instead of dimming it heavily.

## 1.0.21 - 2026-05-16

### Added

- Added GitHub Actions release builds for macOS Intel and Apple Silicon.
- Kept Linux release builds on GitHub Actions for x64 and arm64.

### Changed

- Restored fast startup rendering for themes, server tile backgrounds, and favourite buttons after the 1.0.20 slowdown.
- Expanded release workflow coverage for configured Windows targets.
- Marked macOS packaging as intentionally unsigned.
- Updated release documentation for Windows, Linux, and macOS.

### Fixed

- Fixed Linux `.deb` update installation so it uses the downloaded update file directly.
- Fixed GitHub release publishing configuration.

## 1.0.20 - 2026-05-16

### Added

- Added Linux release output to the build workflow.
- Added a theme setting to disable server tile background images.

### Changed

- Show server-specific autorun favourites in the in-game favourites popup while keeping the server select popup focused on main favourites.
- Include server and favourite column counts in theme exports and restore them on theme import.
- Keep the Check for Updates widget aligned with launcher scaling during window resize.
- Cleaned up heavy shadows and section tints on the main server page.

### Fixed

- Fixed a lint issue from the 1.0.20 release work.

## 1.0.19 - 2026-05-10

### Changed

- Strip cached custom icon paths from imported favourites and server autorun favourites so imported settings do not point at another machine's AppData files.
- Move the F1 menu shortcut handling into the Electron main process so it works in the launcher, in-app URL windows, child windows, and favourites popup.

## 1.0.18 - 2026-05-10

### Changed

- Center launcher content vertically when it fits on screen.
- Keep the overflow fallback top-aligned only when needed.
- Scale the update/version widget with the launcher on smaller screens.

### Fixed

- Fixed the update widget layer so Check for Updates can be hovered and clicked again.

## 1.0.17 - 2026-05-10

### Changed

- Improved launcher layout on shorter laptop screens.
- Let the server list scroll earlier, showing three to six visible server rows where possible.
- Scale the launcher down as a fallback instead of clipping top or bottom content.
- Clamp restored window bounds to the current Windows work area.
- Enable Discord Rich Presence by default for new or reset client settings.

## 1.0.16 - 2026-05-10

### Changed

- Fixed favourites popup custom icons so they render like the main page.
- Expanded the four-column favourites layout to preserve the existing tile width.

## 1.0.15 - 2026-05-09

### Added

- Added `Ctrl+Shift+S` to return to the server select screen from anywhere in the Electron client.
- Added `Ctrl+Shift+F` as the favourites popup shortcut.

### Changed

- Fixed client settings saves so they no longer reset the main server column count or wipe saved favourites.
- Reworked server tile reordering in edit mode with whole-tile drag, stable placement, and a clear hover overlay.
- Reworked favourite tile reordering with cleaner stacked edit and delete controls.
- Prevented accidental server and favourite launches while edit mode is active.
- Updated Help and README shortcut references.
- Reworked the README into a more structured guide covering server management, favourites, edit mode, shortcuts, settings, portable use, and release assets.

## 1.0.14 - 2026-05-09

### Changed

- Replaced the app icon.
- Removed unused original theme styles now that the Codex theme is the hardcoded default.
- Polished selective import/export UI sizing and option order.
- Improved disabled-refresh server tiles by hiding live status/player values and showing cached server metadata.
- Cache Foundry, game system, and game system version details when launching a disabled-refresh server.

## 1.0.13 - 2026-05-09

### Added

- Added selective export options for client settings, server addresses, credentials, per-server autorun favourites, main screen favourites, and theme.
- Added import detection with selectable sections before applying shared settings.
- Added trust confirmations for credential and favourite imports/exports.
- Added readable import/export summary panels.

### Changed

- Changed imports to merge selected data instead of replacing the whole user settings file.

## 1.0.12 - 2026-05-09

### Added

- Added active server highlighting when online players are present, including an Active label, pulsing tile glow, background glow, and smoother sheen.

### Changed

- Serve cached server button backgrounds through a safe app-local protocol instead of `file://` URLs.
- Split renderer vendor chunks to avoid the large vendor chunk warning in Windows builds.

## 1.0.11 - 2026-05-09

### Added

- Added local file favourites, custom favourite icons saved as local files, and fallback icon handling.
- Added the in-game favourites shortcut to Help.

### Changed

- Reworked the client settings modal into clearer two-column sections with compact slider value readouts.
- Reworked the theme editor layout into fixed section columns and hardcoded Codex as the supported theme base.
- Improved edit-mode spacing and tooltip behaviour.
- Refined theme and accent colour handling across settings panels.

## 1.0.10 - 2026-05-09

### Added

- Added website and local-file favourites with custom icons, favicon/file-icon support, and snapshot fallback for sites without favicons.
- Added an in-game favourites popup so favourites can be opened without returning to the server select screen.
- Added per-server autorun favourites for URLs, notes, PDFs, and local files that open automatically when launching a server.
- Added server settings as a modal instead of expanding cards in place.
- Added configurable server and favourite column controls.
- Added safer settings import handling for local-file favourites and per-server autorun files.

### Changed

- Reworked favourites and server-list layouts for cleaner play/edit modes.
- Improved readability of controls over custom background images.
- Updated README content for the Windows-focused release and feature set.

## 1.0.9 - 2026-05-08

### Changed

- Reduced the Windows installed footprint by pruning packaged runtime dependencies.
- Added a clean build step so stale Vite bundles do not accumulate between builds.
- Limited packaged Electron locale files to English locales used by the app.
- Moved renderer-only libraries out of runtime dependencies so they are bundled at build time but not shipped separately.

## 1.0.8 - 2026-05-08

### Added

- Added favourite website quick links that open in the user's default browser.
- Added play/edit mode to keep the main screen cleaner during normal use.
- Added server column controls for one or two server columns.
- Added favourite column controls for two, three, or four columns.
- Added independent scrolling for long server and favourite lists.
- Added region-aware Favorite/Favourite labels.
- Added tooltips for buttons and delayed full-detail tooltips for favourite tiles.
- Added a sample-data helper for testing large server/favourite lists.

### Fixed

- Improved external browser handling for quick links.
- Guarded saved credential decrypt failures so a bad login record does not break server rendering.
- Disabled noisy updater checks while running locally in development.

## 1.0.7 - 2026-05-08

### Fixed

- Fixed manual JSON imports so saved usernames and passwords are imported alongside app and theme settings.
- Improved first-run import to preserve saved login records from the old user data file.
- Added recovery for stale server IDs by duplicating the best matching orphaned login record onto the imported server's current ID.
- Import notifications now confirm that login details were imported too.

## 1.0.6 - 2026-05-07

### Added

- Added a per-server toggle to either automatically log in after autofill or only autofill credentials.

### Changed

- New and existing servers default to automatic login enabled.
- Updated the startup update check so the Check for Updates button changes to Update Available and glows when a newer version is detected, without opening the update modal automatically.

### Fixed

- Fixed auto-login for newer Foundry versions where credentials were filled but login did not submit.
- Kept the older Foundry private submit hook as a fallback while using the normal form/button submit path first.

## 1.0.5 - 2026-05-07

### Added

- Added a setting for opening external links in the default browser.
- Added release notes to the update checker, including when already up to date.
- Added an Update Available button state with a steady glow indicator.
- Added a per-server option to exclude servers from automatic status refresh polling.

### Changed

- Improved first-run import detection for original FVTT Desktop Client data, including older `vtt-desktop-client` folders.
- Import summaries now list imported server names.
- Improved settings modal scrolling on smaller screens.
- Clarified cache path behaviour and wired Clear Cache on Close to clear the Electron session cache.
- Updated README fork/credit notes, unsigned-app warning, and feature table.

## 1.0.4 - 2026-05-07

### Changed

- Refreshed vulnerable dependency resolutions reported by Dependabot.
- Removed unused dev tooling dependencies.
- Updated Vite, Rollup, PostCSS, and related build-time dependencies.
- Updated the Discord REST dependency chain to use a patched `undici`.

## 1.0.3 - 2026-05-07

### Added

- Added a first-run prompt to import settings from the original FVTT Desktop Client data directory.
- Import saved servers, themes, and login details into VE Foundry Client.
- Create a timestamped backup of the existing VE `userData.json` before importing.
- Remember declined import and original-app uninstall prompts.
- Show an import success notification with imported server counts.
- Offer to uninstall the original app only after settings import succeeds.

### Changed

- Clear stale server button background cache references and force a fresh background refresh after import.
- Updated release artifact filenames so in-app updates download correctly.
- Updated README migration notes and feature list.
- Updated the vulnerable transitive `ip-address` dependency through `socks`.

## 1.0.2 - 2026-05-02

### Changed

- Added format, format:check, lint, and typecheck scripts.
- Added `.prettierignore` for build and dependency output.
- Formatted maintained source, style, workflow, and documentation files with Prettier.
- Tuned ESLint configuration for the current Electron/Vue codebase.
- Cleaned up minor lint findings without changing app behaviour.

## 1.0.1 - 2026-05-02

### Added

- Added persisted drag-handle reordering for server buttons.

### Changed

- External HTTP(S), mail, and phone links now open in the user's default browser instead of another Electron app window.
- Moved client configuration form types into a normal TypeScript module so type checking passes cleanly.

### Fixed

- Fixed invalid password-toggle button markup in the server settings template.

## 1.0.0 - 2026-05-02

### Added

- First VE Foundry Client release from the Silvestrae fork.
- Added Foundry v13/v14 compatibility notes.
- Added portable Windows build support.
- Added window size, position, and maximized-state memory.
- Added cached Foundry login-page backgrounds for server buttons.

### Changed

- Updated app branding to VE Foundry Client.
- Updated GitHub update links and release workflow direction.
