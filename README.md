# VE Foundry Client

![Foundry v11](https://img.shields.io/badge/Foundry-v11-lightgreen)
![Foundry v12](https://img.shields.io/badge/Foundry-v12-lightgreen)
![Foundry v13](https://img.shields.io/badge/Foundry-v13-lightgreen)
![Foundry v14](https://img.shields.io/badge/Foundry-v14-lightgreen)
![License MIT](https://img.shields.io/badge/License-MIT-yellow)

VE Foundry Client is an independent, privately maintained Windows fork of JeidoUran's [FVTT Player Client](https://github.com/JeidoUran/fvtt-player-client). I detached this fork from the original fork network so I could keep making changes that suited our game group's needs after the previous fork had gone more than a year without updates.

If the changes suit your table, you are welcome to use this rebranded client. Credit for the original project work goes to [theripper93](https://github.com/theripper93), [omegarogue](https://github.com/OmegaRogue), and [JeidoUran](https://github.com/JeidoUran).

This app is currently unsigned. Windows Defender, SmartScreen, or antivirus software may warn you when downloading or installing it. If you do not want to trust it, do not use it.

## Platform Support

VE Foundry Client is currently built and released for Windows only.

The codebase still keeps macOS and Linux in mind where practical. If you want a macOS or Linux build and are happy to be the tester for that platform, open an issue and I can provide one.

## Features

| Feature                                                            | VE Foundry Client |
| ------------------------------------------------------------------ | :---------------: |
| Foundry v11, v12, v13, and v14 support                             |        Yes        |
| Saved server list with one-click launch                            |        Yes        |
| Saved login details and optional auto-login after autofill         |        Yes        |
| Per-server toggle to autofill only, without auto-login             |        Yes        |
| Back to server select button from setup, login, and game screens   |        Yes        |
| Server status on server buttons                                    |        Yes        |
| Per-server exclusion from automatic status refresh                 |        Yes        |
| Server button background caching from Foundry login pages          |        Yes        |
| Reorderable server buttons                                         |        Yes        |
| One-column or two-column server layout                             |        Yes        |
| Scrollable server list and scrollable expanded server settings     |        Yes        |
| Website and local-file favourites                                  |        Yes        |
| Favourite/favorite spelling follows the user's locale              |        Yes        |
| Favourites popup hotkey while in game (`Ctrl+Alt+F`)               |        Yes        |
| Custom favourite icons/images, favicons, snapshots, and file icons |        Yes        |
| Favourite layout controls with two, three, or four columns         |        Yes        |
| Play/edit mode to keep the main screen clean                       |        Yes        |
| Toggle to open external links in the default browser               |        Yes        |
| Release notes shown in the update checker                          |        Yes        |
| Update available button indicator                                  |        Yes        |
| Theme editor                                                       |        Yes        |
| Settings and theme import/export                                   |        Yes        |
| First-run import from the original FVTT Desktop Client folders     |        Yes        |
| Portable Windows build                                             |        Yes        |
| Window size, position, and maximized state persistence             |        Yes        |
| Discord Rich Presence support                                      |        Yes        |

## Main Screen

The main screen has two modes:

- **Play mode** hides editing controls and keeps the server and favourites lists clean.
- **Edit mode** shows add fields, edit/delete controls, drag handles, and column layout controls.

Servers can be shown in one or two columns. Favourites can be shown in two, three, or four columns. Long server and favourite lists scroll inside their own areas instead of moving the whole page.

## Servers

Each server entry can store:

- Server name and URL
- Foundry login username
- User password and admin password
- Whether the app should auto-login after autofill
- Whether that server should be excluded from automatic status refresh

The status refresh exclusion is useful for cloud-hosted Foundry servers where polling the server can wake an instance and create hosting cost.

Server button backgrounds are fetched from the Foundry login page and cached locally. Cached backgrounds work for normal installs and portable builds.

## Favourites

Favourites are quick-launch tiles for websites or local files.

- Website favourites always open in the user's default browser.
- Local file favourites open with the user's default app for that file type.
- File favourites use the operating system's file icon when available.
- Website favourites try a favicon first, then a snapshot-style fallback if the favicon fails.
- Users can choose a custom icon or image for any favourite, which overrides all automatic icons.

Press `Ctrl+Alt+F` from any client window to open the favourites popup. This works while you are inside a Foundry server, so you do not need to return to the server select screen just to open a favourite.

When importing shared settings, local-file favourites are only imported if the referenced file exists on the current machine. This prevents broken local-file favourites from being created on another user's computer.

## Settings Import

On first run, VE Foundry Client checks for settings from the original FVTT Desktop Client, including older `vtt-desktop-client` data folders. If settings are found, the app asks whether to import them.

The import can bring across servers, theme settings, and saved login details. Before importing, the app backs up the current VE Foundry Client `userData.json`.

After a successful original-app import, the app may remind you that you can uninstall the original client if you no longer need it.

## Sharing Settings

The Share menu can export:

- Full settings, including app configuration and theme
- Theme only

Imports can be pasted as JSON text or loaded from a JSON file.

Exported settings do not include saved usernames, passwords, admin passwords, or local font-file paths. They may include favourite entries. Local-file favourites are checked during import and skipped if the file does not exist on the importing computer.

## Theme Editor

The theme editor can adjust:

- Base theme
- Background images
- Text, accent, and button colours
- Button opacity
- Particle effects
- Google Font URLs
- Local font files

## External Links

External links can be opened in the system default browser. This is enabled by default and can be toggled in settings.

## Updates

The app can check GitHub releases for updates. When an update is available, the update button changes state and the updater shows release notes for the latest version.

## Discord Rich Presence

Discord Rich Presence requires the [Foundry VTT Rich Presence](https://github.com/JeidoUran/fvtt-rich-presence) module to be installed and enabled in each Foundry world where you want presence updates.

You must enable Rich Presence in both:

- VE Foundry Client settings
- The Foundry module settings

## Development

Common commands:

```powershell
npm.cmd run format
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run dist:win
```

The project currently builds Windows installer, portable, and zip artifacts. The packaging config keeps portable app data support working alongside normal installer support.

## Acknowledgments

Special thanks to theripper93 and OmegaRogue for creating the original client, and to JeidoUran for the fork this project was based on.

Rich Presence uses [@xhayper/discord-rpc](https://www.npmjs.com/package/@xhayper/discord-rpc).

Client and Rich Presence icons were designed by [Freepik](http://www.freepik.com/).

## Disclaimer

Parts of this fork have been written with help from ChatGPT. If you spot a bug, a rough edge, or something that could be improved, please open a [GitHub Issue](https://github.com/Silvestrae/ve-foundry-client/issues) or [Pull Request](https://github.com/Silvestrae/ve-foundry-client/pulls).
