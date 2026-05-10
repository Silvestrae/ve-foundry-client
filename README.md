# <img src="VE.png" alt="VE Foundry Client logo" height="40"> VE Foundry Client

![Foundry v11](https://img.shields.io/badge/Foundry-v11-lightgreen)
![Foundry v12](https://img.shields.io/badge/Foundry-v12-lightgreen)
![Foundry v13](https://img.shields.io/badge/Foundry-v13-lightgreen)
![Foundry v14](https://img.shields.io/badge/Foundry-v14-lightgreen)
![Windows](https://img.shields.io/badge/Platform-Windows-blue)
![License MIT](https://img.shields.io/badge/License-MIT-yellow)

VE Foundry Client is an independent, privately maintained Windows fork of JeidoUran's [FVTT Player Client](https://github.com/JeidoUran/fvtt-player-client). It keeps the original goal of a lightweight Foundry VTT desktop launcher, then adds quality-of-life tools for managing multiple worlds, favourites, themes, shared settings, and portable Windows use.

This app is currently unsigned. Windows Defender, SmartScreen, or antivirus software may warn you when downloading or installing it. If you do not want to trust an unsigned private-use build, do not use it.

## Contents

### Quick Start

- [Platform Support](#platform-support)
- [Install And Portable Builds](#install-and-portable-builds)
- [Play Mode And Edit Mode](#play-mode-and-edit-mode)
- [Keyboard Shortcuts](#keyboard-shortcuts)

### Feature Guide

- [Server Launcher](#server-launcher)
- [Server Status And Backgrounds](#server-status-and-backgrounds)
- [Server Settings](#server-settings)
- [Favourites](#favourites)
- [Server Autorun Favourites](#server-autorun-favourites)
- [In-Game Favourites Popup](#in-game-favourites-popup)
- [Client Settings](#client-settings)
- [Theme Editor](#theme-editor)
- [Sharing, Import, And Export](#sharing-import-and-export)
- [Original Client Import](#original-client-import)
- [Updates](#updates)
- [Discord Rich Presence](#discord-rich-presence)

### Project

- [Acknowledgments](#acknowledgments)
- [Disclaimer](#disclaimer)

## Feature Overview

### Server Management

| Feature                       | Details                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| Multi-version Foundry support | Designed for Foundry v11, v12, v13, and v14 servers.                                                 |
| Saved server tiles            | Store server names, URLs, login credentials, admin passwords, and per-server options.                |
| Play/edit modes               | Keep the launcher clean while playing, then reveal controls only when editing.                       |
| Drag reordering               | Reorder server tiles by dragging the whole tile in edit mode.                                        |
| Server columns                | Show servers in one or two columns.                                                                  |
| Server status                 | Display online status, Foundry version, world name, game system, system version, and online players. |
| Per-server refresh control    | Disable automatic status refresh for servers where polling is undesirable.                           |
| Cached tile backgrounds       | Pull and cache background art from Foundry login pages.                                              |

### Favourites

| Feature               | Details                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Website favourites    | Open saved websites in the system default browser.                                                |
| Local-file favourites | Open local files with the default Windows app for that file type.                                 |
| Smart icons           | Use custom icons, favicons, website snapshots, or Windows file icons.                             |
| Drag reordering       | Reorder favourites by dragging the whole favourite tile in edit mode.                             |
| Favourite columns     | Show favourites in two, three, or four columns.                                                   |
| Server autorun        | Attach favourites to a server so they open automatically when that server launches.               |
| In-game popup         | Press `Ctrl+Shift+F` from any client window to open favourites without returning to the launcher. |

### Configuration And Sharing

| Feature                | Details                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Client settings        | Configure cache, certificates, external links, fullscreen, session sharing, server status, and Discord Rich Presence. |
| Theme editor           | Adjust base theme, backgrounds, fonts, colours, opacity, and particles.                                               |
| Share exports          | Export full settings, selected settings, theme data, servers, and favourites.                                         |
| Safe imports           | Import shared JSON from text or file, with local-file favourites checked before import.                               |
| Original client import | Import settings from the original FVTT Desktop Client data folders on first run.                                      |
| Portable support       | Installer and portable builds are both supported.                                                                     |
| Window persistence     | Restore size, position, and maximized state.                                                                          |

## Platform Support

VE Foundry Client is currently built and released for Windows only.

The codebase still keeps macOS and Linux in mind where practical. If you want a macOS or Linux build and are happy to test that platform, open an issue and one can be provided.

## Install And Portable Builds

GitHub releases can include:

- A Windows installer
- A portable Windows build
- A zipped Windows build

Portable support is kept alongside installer support. Portable builds should keep their app data with the portable package rather than behaving like a normal installed app.

Because the app is unsigned, Windows may show a warning the first time you run it.

## Play Mode And Edit Mode

The launcher has two main modes.

**Play mode** is the clean daily-use view. Editing controls are hidden, server tiles open servers, favourites open their target, and the page stays focused on launching what you need.

**Edit mode** is for maintenance. It reveals add fields, server/favourite layout controls, server settings buttons, refresh buttons, favourite edit/delete buttons, and drag reordering.

In edit mode:

- Clicking a server tile does not enter the server.
- Clicking a favourite tile does not open the favourite.
- Dragging a server or favourite tile reorders it.
- Server and favourite tiles show a blurred "Click and drag to reorder" overlay.
- Settings and refresh buttons remain clickable.

## Keyboard Shortcuts

| Shortcut                    | Action                                              |
| --------------------------- | --------------------------------------------------- |
| `Ctrl+Shift+F`              | Toggle the favourites popup from any client window. |
| `Ctrl+Shift+S`              | Return to the server select screen.                 |
| `Ctrl+R` or `F5`            | Reload the current page.                            |
| `Ctrl+Shift+R` or `Ctrl+F5` | Force reload the current page.                      |
| `Ctrl++` / `Ctrl+Shift++`   | Zoom in.                                            |
| `Ctrl+-`                    | Zoom out.                                           |
| `Ctrl+0`                    | Reset zoom.                                         |
| `Ctrl+Shift+I` or `F12`     | Open developer tools.                               |

## Server Launcher

Server tiles are the heart of the app. Each tile represents a Foundry server and can be launched with one click in play mode.

Server tiles can show:

- Server name
- Connection status
- Foundry version
- World name
- Game system
- Game system version
- Online player count
- Cached server artwork

Use the column selector above the server list to switch between a compact one-column layout and a wider two-column layout. Long server lists scroll inside the server area instead of pushing the whole page down.

## Server Status And Backgrounds

VE Foundry Client can ping saved servers and display status information directly on each server tile.

Status fields can be enabled or disabled in client settings. Automatic refresh has a configurable refresh interval.

Per-server status refresh can also be disabled. This is useful for cloud-hosted Foundry servers where polling a dormant server may wake it and create hosting cost.

The app can also cache a server tile background from a Foundry login page. Cached backgrounds work for normal installs and portable builds.

## Server Settings

Each server entry can store:

- Server name
- Server URL
- Foundry username
- User password
- Admin password
- Auto-login preference
- Status auto-refresh preference
- Autorun favourites for that server

Auto-login can be disabled per server while still allowing credential autofill.

## Favourites

Favourites are quick-launch tiles for websites and local files.

Website favourites:

- Open in the user's default browser.
- Try a favicon first.
- Fall back to a snapshot-style image if no favicon works.

Local-file favourites:

- Open with the Windows default app for that file type.
- Use the operating system's file icon where available.
- Are checked during import so broken local paths are not blindly added on another machine.

Custom favourite icons or images override all automatic icon choices.

In edit mode, favourites can be reordered by dragging the whole tile. The edit and delete buttons are stacked on the right side of each favourite tile.

## Server Autorun Favourites

Autorun favourites let a server open useful companion resources automatically when you launch it.

Examples:

- A campaign wiki
- A shared notes document
- A rules reference
- A local PDF
- A music, map, or handout folder

Autorun favourites are managed from the server settings modal. Each server has its own autorun list, separate from the main favourites section.

Autorun favourites use the same favourite model as the main screen:

- Website autorun favourites open in the system default browser.
- Local-file autorun favourites open with the Windows default app for that file type.
- Custom icons and automatic icon handling still apply where relevant.

When sharing settings, per-server autorun favourites can be exported separately from the main screen favourites. During import, local-file autorun favourites are checked and skipped if the referenced file does not exist on the importing computer.

## In-Game Favourites Popup

Press `Ctrl+Shift+F` from any client window to open the favourites popup.

This works while you are inside a Foundry server, so you do not need to return to the main launcher just to open a reference site, PDF, local document, or other saved favourite.

## Client Settings

Client settings include:

- Cache path
- Clear cache on close
- Certificate error handling
- External links opening in the default browser
- Notification duration
- Fullscreen behavior
- Session sharing between windows
- Server status display options
- Server status refresh rate
- Discord Rich Presence

Saving client settings preserves unrelated launcher data such as server columns, favourite columns, saved favourites, and window bounds.

## Theme Editor

The theme editor can adjust:

- Base theme
- Background image collection
- Background colour
- Text colour
- Accent colour
- Button colour and opacity
- Button hover colour and opacity
- Particle effects
- Google Font URLs
- Local font files

Theme imports do not include local font-file paths, because those paths are machine-specific.

## Sharing, Import, And Export

The Share menu can export selected parts of the app configuration.

Export options include:

- Client settings
- Theme
- Server addresses
- Server credentials
- Main screen favourites
- Per-server autorun favourites

Imports can be pasted as JSON text or loaded from a JSON file.

Exported settings do not include saved usernames, passwords, admin passwords, or local font-file paths unless the relevant credential export option is explicitly selected. Local-file favourites are checked on import and skipped if the target file does not exist on the importing computer.

## Original Client Import

On first run, VE Foundry Client checks for settings from the original FVTT Desktop Client, including older `vtt-desktop-client` data folders.

If settings are found, the app asks whether to import them. The import can bring across servers, theme settings, and saved login details.

Before importing, the app backs up the current VE Foundry Client `userData.json`.

After a successful original-client import, the app may remind you that the original client can be uninstalled if you no longer need it.

## Updates

The app can check GitHub releases for updates.

When an update is available:

- The update button changes state.
- The updater modal shows release notes.
- GitHub release and action support can publish installer and portable Windows artifacts.

## Discord Rich Presence

Discord Rich Presence requires the [Foundry VTT Rich Presence](https://github.com/JeidoUran/fvtt-rich-presence) module to be installed and enabled in each Foundry world where you want presence updates.

Enable Rich Presence in both places:

- VE Foundry Client settings
- The Foundry module settings

## Acknowledgments

Special thanks to [theripper93](https://github.com/theripper93) and [OmegaRogue](https://github.com/OmegaRogue) for creating the original client, and to [JeidoUran](https://github.com/JeidoUran) for the fork this project was based on.

Rich Presence uses [@xhayper/discord-rpc](https://www.npmjs.com/package/@xhayper/discord-rpc).

Client and Rich Presence icons were designed by [Freepik](http://www.freepik.com/).

## Disclaimer

Development in this fork has been vibe-coded in Codex. If you spot a bug, a rough edge, or something that could be improved, please open a [GitHub Issue](https://github.com/Silvestrae/ve-foundry-client/issues) or [Pull Request](https://github.com/Silvestrae/ve-foundry-client/pulls).
