# VE Foundry Client

![Static Badge](https://img.shields.io/badge/Foundry-v11-lightgreen)
![Static Badge](https://img.shields.io/badge/Foundry-v12-lightgreen)
![Static Badge](https://img.shields.io/badge/Foundry-v13-lightgreen)
![Static Badge](https://img.shields.io/badge/Foundry-v14-lightgreen)
![Static Badge](https://img.shields.io/badge/License-MIT-yellow)

A simple and lightweight, Chromium based, desktop client for Foundry VTT.

Original Wiki https://wiki.theripper93.com/free/vtt-desktop-client

## Differences between the player clients

| Feature                                      | [theripper93](https://github.com/theripper93/fvtt-player-client) | [omegarogue](https://github.com/OmegaRogue/fvtt-player-client) | [jeidouran](https://github.com/JeidoUran/fvtt-player-client) | [Silvestrae](https://github.com/Silvestrae/ve-foundry-client) |
| -------------------------------------------- | :--------------------------------------------------------------: | :------------------------------------------------------------: | :----------------------------------------------------------: | :-----------------------------------------------------------: |
| Back to server select button in setup screen | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Back to server select button in login screen | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Back to server select button in game         | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Foundry v13/v14 Compatibility                | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Discord Rich Presence                        | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Server status on game buttons                | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Theme editor                                 | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Cached server background buttons             | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Fully portable Windows build                 | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Remembers window size and position           | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Remembers maximized window state             | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| External links open in default browser       | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |
| Reorder server buttons                       | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![No](https://img.shields.io/badge/-✗-cf222e)  | ![Yes](https://img.shields.io/badge/-✓-2ea44f) |

## Server Backgrounds

VE Foundry Client can use each Foundry server's login-page background as the background for that server's button. Backgrounds are cached locally in the app data folder, so they load quickly on startup and still work for portable builds.

- New servers fetch and cache their background when added.
- Opening a server checks whether its background URL changed and updates the local cache when needed.
- Saving server settings forces a fresh background download.
- If a reachable server no longer has a background, the cached button image is cleared. If the server is offline, the last cached background is kept.

## Discord Rich Presence

In order to enable and use Rich Presence, you also need to have the module [Foundry VTT Rich Presence](https://github.com/JeidoUran/fvtt-rich-presence) installed and enabled on each world you want to use it with. Furthermore, you need to enable the option **Enable Discord Rich Presence** in both the **Client Configuration** and the **Module Settings**, as it is off by default.
![image](https://github.com/user-attachments/assets/3419b6a5-48db-4dae-9469-dd791a31390e)
![image](https://github.com/user-attachments/assets/aad94072-6e39-4138-88a0-28fbc687d02c)

## Customization

The **Theme Editor** lets you tweak every aspect of the client’s look and feel:

1. **Base Theme**  
   Choose either **Codex** or **Original** as your starting point.

2. **Fine-tune colors & effects**  
   Adjust background(s), text, accent and button colors, as well as particle effects (count, speed & opacity).

3. **Custom assets**
   - **Background images**: upload your own.
   - **Fonts**: import from Google Fonts URLs or load a local font file.

## Sharing & Portability

Open the **Share** menu to **export** or **import** your configuration:

- **Export**

  - Full settings (app + theme)
  - Theme only

- **Import**
  - From a JSON file
  - From clipboard

You can save the JSON to disk or copy it to your clipboard.  
Perfect for GMs who want to distribute a custom setup or theme to their players.

> **Privacy note:** Exported files never include sensitive fields like auto-login usernames, passwords, admin passwords, or local font-file paths.

Example Full Settings Export:

```json
{
  "clientVersion": "1.13.0",
  "app": {
    "games": [
      {
        "name": "Foundry VTT Web Demo",
        "url": "https://demo.foundryvtt.com/join",
        "id": 110403
      }
    ],
    "cachePath": "",
    "autoCacheClear": false,
    "ignoreCertificateErrors": false,
    "discordRP": true,
    "notificationTimer": 3,
    "serverInfoEnabled": true,
    "serverInfoOptions": {
      "statusEnabled": true,
      "foundryVersionEnabled": true,
      "worldEnabled": false,
      "gameSystemEnabled": true,
      "gameSystemVersionEnabled": true,
      "onlinePlayersEnabled": true
    },
    "serverInfoPingRate": 30,
    "fullScreenEnabled": false,
    "shareSessionWindows": false
  },
  "theme": {
    "background": "",
    "backgrounds": [],
    "backgroundColor": "#0e1a23",
    "textColor": "#88c0a9",
    "accentColor": "#98e4f7",
    "buttonColorAlpha": 0.65,
    "buttonColor": "#14141e",
    "buttonColorHoverAlpha": 0.95,
    "buttonColorHover": "#28283c",
    "particlesEnabled": true,
    "particleOptions": {
      "count": 100,
      "speedYMin": 0.15,
      "speedYMax": 0.3,
      "color": "#63b0c4",
      "alpha": 0.15
    },
    "baseTheme": "codex",
    "fontPrimary": "",
    "fontSecondary": ""
  }
}
```

## Acknowledgments and attributions

Special thanks to theripper93 and OmegaRogue for creating this client. I am no developper and without their amazing work it would have been impossible to make those updates.

Rich Presence implemented thanks to @xhayper and their excellent [discord-rpc](https://www.npmjs.com/package/@xhayper/discord-rpc?activeTab=readme).

Client and Rich Presence icons designed by [Freepik](http://www.freepik.com/).

## Disclaimer

Parts of the code have been generated by an artificial intelligence language model (ChatGPT). If you see anything weird and/or that could be done in a better way, feel free to submit a [GitHub Issue](https://github.com/Silvestrae/ve-foundry-client/issues) or [Pull Request](https://github.com/Silvestrae/ve-foundry-client/pulls).

## Support

For issues, suggestions, or contributions, please submit a [GitHub Issue](https://github.com/Silvestrae/ve-foundry-client/issues) or [Pull Request](https://github.com/Silvestrae/ve-foundry-client/pulls).
