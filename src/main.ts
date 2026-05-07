// noinspection ES6MissingAwait,JSIgnoredPromiseFromCall

import {
  app,
  net,
  BrowserWindow,
  ipcMain,
  safeStorage,
  session,
  nativeImage,
  dialog,
  shell,
  Menu,
  MenuItemConstructorOptions,
  screen,
} from "electron";
import {
  UserDataSchema,
  ThemeConfigSchema,
  AppConfigSchema,
  GameUserDataSchema,
  UserData,
  AppConfig,
  ThemeConfig,
  WindowBounds,
  CURRENT_SCHEMA_VERSION,
} from "./schemas";
import {
  enableRichPresence,
  disableRichPresence,
} from "./richPresence/richPresenceControl";
import {
  startRichPresenceSocket,
  closeRichPresenceSocket,
} from "./richPresence/richPresenceSocket";
import path from "path";
import fs from "fs-extra";
import { fileURLToPath, pathToFileURL } from "url";
import log from "electron-log";
import { autoUpdater } from "electron-updater";
import { installDebUpdate } from "./utils/installUpdate";
import { sendUpdateStatus, setUpdateWindow } from "./utils/updateStatus";

const isPortableWindows =
  process.platform === "win32" && !!process.env.PORTABLE_EXECUTABLE_DIR;

if (isPortableWindows) {
  const portableDataPath = path.join(
    process.env.PORTABLE_EXECUTABLE_DIR!,
    "data",
  );
  fs.ensureDirSync(portableDataPath);
  app.setPath("userData", portableDataPath);
  app.setPath("sessionData", path.join(portableDataPath, "session"));
}

const fileTransport = log.transports.file;
(fileTransport as any).getFile = () =>
  path.join(app.getPath("userData"), "main.log");
fileTransport.level = "info";

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

const MAIN_WINDOW_VITE_DEV_SERVER_URL = !app.isPackaged
  ? "http://localhost:5173"
  : "";
const MAIN_WINDOW_VITE_NAME = "main_window";

let initialCheckInProgress = true;

if (require("electron-squirrel-startup")) app.quit();

// workaround for gtk version preventing app launch on certain Linux distros while using Electron 36
app.commandLine.appendSwitch("gtk-version", "3");

app.commandLine.appendSwitch("force_high_performance_gpu");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

/* Remove the comment (//) from the line below to ignore certificate errors (useful for self-signed certificates) */

//app.commandLine.appendSwitch("ignore-certificate-errors");

let mainWindow: BrowserWindow;
let lastUpdateRequestingWindow: BrowserWindow | null = null;

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  width: 800,
  height: 600,
};

const ORIGINAL_APP_USER_DATA_DIR_NAMES = [
  "FVTT Desktop Client",
  "FVTT Player Client",
  "VTT Desktop Client",
  "fvtt-player-client",
] as const;

type MigrationStatus = "skipped" | "success" | "failure";

function getUserDataPath() {
  return path.join(app.getPath("userData"), "userData.json");
}

function migrateUserDataObject(rawData: unknown) {
  const themeKeys = [
    "background",
    "backgrounds",
    "backgroundColor",
    "textColor",
    "accentColor",
    "buttonColorAlpha",
    "buttonColor",
    "theme",
    "particlesEnabled",
  ] as const;

  const dataObj =
    typeof rawData === "object" && rawData !== null
      ? { ...(rawData as Record<string, any>) }
      : {};

  let migrated = false;
  dataObj.theme = dataObj.theme ?? {};
  if (dataObj.app) {
    for (const key of themeKeys) {
      if ((dataObj.app as any)[key] !== undefined) {
        (dataObj.theme as any)[key] = (dataObj.app as any)[key];
        delete (dataObj.app as any)[key];
        migrated = true;
      }
    }
  }
  if (dataObj.theme && (dataObj.theme as any).theme !== undefined) {
    (dataObj.theme as any).baseTheme = (dataObj.theme as any).theme;
    delete (dataObj.theme as any).theme;
    migrated = true;
  }

  return { data: dataObj, migrated };
}

async function migrateUserData(): Promise<MigrationStatus> {
  const userDataPath = getUserDataPath();
  let rawData: unknown = {};
  try {
    rawData = JSON.parse(fs.readFileSync(userDataPath, "utf-8"));
  } catch {
    rawData = {};
  }
  try {
    const themeKeys = [
      "background",
      "backgrounds",
      "backgroundColor",
      "textColor",
      "accentColor",
      "buttonColorAlpha",
      "buttonColor",
      "theme",
      "particlesEnabled",
    ] as const;

    const dataObj =
      typeof rawData === "object" && rawData !== null
        ? { ...(rawData as Record<string, any>) }
        : {};

    let migrated = false;
    dataObj.theme = dataObj.theme ?? {};
    if (dataObj.app) {
      for (const key of themeKeys) {
        if ((dataObj.app as any)[key] !== undefined) {
          (dataObj.theme as any)[key] = (dataObj.app as any)[key];
          delete (dataObj.app as any)[key];
          migrated = true;
        }
      }
    }
    // If theme is detected on old schema
    if (dataObj.theme && (dataObj.theme as any).theme !== undefined) {
      // Rename theme → baseTheme in dataObj.theme
      (dataObj.theme as any).baseTheme = (dataObj.theme as any).theme;
      delete (dataObj.theme as any).theme;
      migrated = true;
    }
    if (migrated) {
      fs.writeFileSync(userDataPath, JSON.stringify(dataObj, null, 2));
      rawData = dataObj;
      return "success";
    } else {
      return "skipped";
    }
  } catch (e) {
    console.warn("[getUserData] Migration failed :", e);
    return "failure";
  }
}

export function getUserData(): UserData {
  if (require("electron-squirrel-startup")) return;
  const userDataPath = getUserDataPath();
  let rawData: unknown = {};

  // Secure read
  try {
    rawData = JSON.parse(
      fs.readFileSync(
        userDataPath,
        "userData.json" in fs.readFileSync ? "utf-8" : "utf-8",
      ),
    );
  } catch {
    rawData = {};
  }

  // Check if file exists and create it if not
  const fileExists = fs.existsSync(userDataPath);
  const isEmpty =
    typeof rawData === "object" &&
    rawData !== null &&
    Object.keys(rawData).length === 0;
  if (!fileExists || isEmpty) {
    // let Zod (i hate him) generate a valid userData
    const defaultApp = AppConfigSchema.parse({ games: [] });
    const defaultTheme = ThemeConfigSchema.parse({});
    const defaultData = UserDataSchema.parse({
      app: defaultApp,
      theme: defaultTheme,
    });

    fs.writeFileSync(
      userDataPath,
      JSON.stringify(defaultData, null, 2),
      "utf-8",
    );
    return defaultData;
  }

  // Validate + clean + backup on each call
  try {
    const validation = UserDataSchema.safeParse(rawData);
    if (!validation.success) {
      askPrompt(
        `Invalid configuration detected: a backup of your previous settings has been created, and any invalid values have been reset to their defaults.`,
        { mode: "alert" },
      );
      // Backup
      try {
        const bakPath = userDataPath.replace(/\.json$/, ".bak.json");
        fs.copyFileSync(userDataPath, bakPath);
      } catch {
        /**/
      }

      // Only delete erroneous keys
      const dataObj = { ...(rawData as Record<string, any>) };
      for (const issue of validation.error.issues) {
        if (!issue.path.length) continue;
        let obj: any = dataObj;
        for (let i = 0; i < issue.path.length - 1; i++) {
          const p = issue.path[i];
          if (obj && typeof obj[p] === "object") obj = obj[p];
          else {
            obj = null;
            break;
          }
        }
        const last = issue.path.at(-1);
        if (obj && typeof last === "string") {
          delete obj[last];
        }
      }

      // Write corrected JSON
      try {
        fs.writeFileSync(userDataPath, JSON.stringify(dataObj, null, 2));
        rawData = dataObj;
      } catch {
        console.warn("[getUserData] Could not write cleaned userData");
      }
    }
  } catch (e) {
    console.warn("[getUserData] Zod Validation Failed :", e);
  }

  // ── Final parse, then update schemaVersion & lastRunAppVersion ──
  try {
    const data = UserDataSchema.parse(rawData) as UserData;
    const appVer = app.getVersion();
    let dirty = false;

    // Migrate schemaVersion if needed
    if (data.schemaVersion < CURRENT_SCHEMA_VERSION) {
      // TODO: run your migration routines here…
      data.schemaVersion = CURRENT_SCHEMA_VERSION;
      dirty = true;
    }

    // Update lastRunAppVersion
    if (data.lastRunAppVersion !== appVer) {
      data.lastRunAppVersion = appVer;
      dirty = true;
    }

    // If one or the other was increased, rewrite userData.json
    if (dirty) {
      try {
        fs.writeFileSync(userDataPath, JSON.stringify(data, null, 2), "utf-8");
      } catch (e) {
        console.warn("[getUserData] Could not persist updated version:", e);
      }
    }

    return data;
  } catch (e) {
    console.error(
      "[getUserData] Final parsing failed, regenerating a clean userData :",
      e,
    );
    // As last resort, return an empty userData
    return UserDataSchema.parse({ app: { games: [] }, theme: {} });
  }
}

type OriginalUserDataCandidate = {
  appName: string;
  userDataPath: string;
};

const STATIC_USER_DATA_KEYS = new Set([
  "app",
  "theme",
  "cachePath",
  "schemaVersion",
  "lastRunAppVersion",
]);

function normalizePathForCompare(filePath: string) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function getOriginalUserDataCandidates(): OriginalUserDataCandidate[] {
  const roots = new Set<string>();
  try {
    roots.add(app.getPath("appData"));
  } catch {
    // appData is only available after Electron is ready.
  }
  if (process.env.APPDATA) roots.add(process.env.APPDATA);
  if (process.platform === "linux") {
    roots.add(
      process.env.XDG_CONFIG_HOME ?? path.join(app.getPath("home"), ".config"),
    );
  }
  if (process.platform === "darwin") {
    roots.add(path.join(app.getPath("home"), "Library", "Application Support"));
  }

  const currentUserDataPath = normalizePathForCompare(getUserDataPath());
  const candidates: OriginalUserDataCandidate[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    for (const appName of ORIGINAL_APP_USER_DATA_DIR_NAMES) {
      const userDataPath = path.join(root, appName, "userData.json");
      const normalizedPath = normalizePathForCompare(userDataPath);
      if (normalizedPath === currentUserDataPath || seen.has(normalizedPath)) {
        continue;
      }
      seen.add(normalizedPath);
      candidates.push({ appName, userDataPath });
    }
  }

  return candidates;
}

function getOriginalUserDataCandidate() {
  return (
    getOriginalUserDataCandidates().find((candidate) =>
      fs.pathExistsSync(candidate.userDataPath),
    ) ?? null
  );
}

function prepareImportedUserData(rawData: unknown): UserData {
  const { data } = migrateUserDataObject(rawData);
  const defaultApp = AppConfigSchema.parse({ games: [] });
  const defaultTheme = ThemeConfigSchema.parse({});
  const appResult = AppConfigSchema.safeParse(data.app);
  const themeResult = ThemeConfigSchema.safeParse(data.theme);
  const importedData: Record<string, any> = {
    app: appResult.success ? appResult.data : defaultApp,
    theme: themeResult.success ? themeResult.data : defaultTheme,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastRunAppVersion: app.getVersion(),
  };

  if (typeof data.cachePath === "string") {
    importedData.cachePath = data.cachePath;
  }

  for (const [key, value] of Object.entries(data)) {
    if (STATIC_USER_DATA_KEYS.has(key)) continue;
    const loginResult = GameUserDataSchema.safeParse(value);
    if (loginResult.success) {
      importedData[key] = loginResult.data;
    }
  }

  const imported = UserDataSchema.parse(importedData);
  for (const game of imported.app?.games ?? []) {
    delete game.backgroundImageLocalUrl;
    delete game.backgroundImageFileName;
    delete game.backgroundImageUpdatedAt;
  }

  return imported;
}

function reloadWindowAndRefreshServerBackgrounds(win: BrowserWindow) {
  win.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.webContents.send("refresh-server-backgrounds");
      }
    }, 750);
  });
  win.reload();
}

async function promptImportOriginalUserData(win: BrowserWindow) {
  const candidate = getOriginalUserDataCandidate();
  if (!candidate) return false;

  const shouldImport = await askPrompt(
    `Saved settings from ${candidate.appName} were found. Import servers, themes, and login details into VE Foundry Client? Server button backgrounds will be refreshed after import.`,
    undefined,
    win,
  );
  if (!shouldImport) return false;

  try {
    const rawData = JSON.parse(
      fs.readFileSync(candidate.userDataPath, "utf-8"),
    );
    const importedData = prepareImportedUserData(rawData);
    fs.ensureDirSync(app.getPath("userData"));
    fs.writeFileSync(
      getUserDataPath(),
      JSON.stringify(importedData, null, 2),
      "utf-8",
    );
    notifyMainWindow(`Imported settings from ${candidate.appName}`, win);
    reloadWindowAndRefreshServerBackgrounds(win);
    return true;
  } catch (e) {
    console.warn("[getUserData] Original app import failed:", e);
    await askPrompt(
      `Could not import settings from ${candidate.appName}.`,
      { mode: "alert" },
      win,
    );
    return false;
  }
}

function returnToServerSelect(win: BrowserWindow) {
  const id = win.webContents.id;
  windowsData[id].autoLogin = true;
  delete windowsData[id].selectedServerName;
  disableRichPresence();
  closeRichPresenceSocket();

  if (!app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // ► in production, load the file we just packed into /renderer/…
    const indexHtml = path.join(
      __dirname,
      "../../renderer",
      MAIN_WINDOW_VITE_NAME,
      "index.html",
    );
    win.loadFile(indexHtml);
  }
}

function notifyMainWindow(message: string, winOverride?: BrowserWindow) {
  const win = winOverride ?? mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send("show-notification", message);
  }
}

function isAppRendererUrl(url: string): boolean {
  if (!url) return true;
  if (!app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  }
  return url.startsWith("file:");
}

function shouldOpenInExternalBrowser(
  currentUrl: string,
  targetUrl: string,
): boolean {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return false;
  }

  if (["mailto:", "tel:"].includes(target.protocol)) {
    return true;
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return false;
  }

  if (isAppRendererUrl(currentUrl)) {
    return false;
  }

  try {
    return new URL(currentUrl).origin !== target.origin;
  } catch {
    return true;
  }
}

function openUrlInDefaultBrowser(url: string) {
  shell.openExternal(url).catch((err) => {
    console.error("Failed to open external URL", url, err);
  });
}

function hookExternalLinkHandling(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenInExternalBrowser(win.webContents.getURL(), url)) {
      openUrlInDefaultBrowser(url);
      return { action: "deny" };
    }

    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        parent: win,
        autoHideMenuBar: true,
      },
    };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (!shouldOpenInExternalBrowser(win.webContents.getURL(), url)) return;

    event.preventDefault();
    openUrlInDefaultBrowser(url);
  });

  win.webContents.on("did-create-window", (childWindow) => {
    hookExternalLinkHandling(childWindow);
  });
}

/**
 * Displays safePrompt in renderer in a given window and retrieve answer
 */
function askPrompt(
  message: string,
  options?: { mode: "confirm" | "alert" },
  winOverride?: BrowserWindow,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const id = Date.now();
    // Listen to renderer (good guy i like him unlike zod)
    ipcMain.once(`prompt-response-${id}`, (_e, answer: boolean) => {
      resolve(answer);
    });
    // Ask renderer to display prompt in target window
    const win = winOverride ?? mainWindow;
    win.webContents.send("show-prompt", { id, message, options });
  });
}

function hookFullScreenEvents(win: BrowserWindow) {
  win.on("enter-full-screen", () => {
    win.webContents.send("fullscreen-changed", true);
  });
  win.on("leave-full-screen", () => {
    win.webContents.send("fullscreen-changed", false);
  });
}

const windows = new Set<BrowserWindow>();

/** Check if single instance, if not, simply quit new instance */
const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    createWindow();
  });
}

const windowsData = {} as WindowsData;

let partitionId: number = 0;

function getSession(): Electron.Session {
  // Read user config
  const { shareSessionWindows } = getAppConfig();
  if (shareSessionWindows) {
    // All windows share the same session
    return session.defaultSession;
  }
  // Current behavior : new partition for each window
  const partitionIdTemp = partitionId;
  partitionId++;
  if (partitionIdTemp === 0) return session.defaultSession;
  return session.fromPartition(`persist:${partitionIdTemp}`, { cache: true });
}

function getSavedWindowBounds(): WindowBounds {
  const bounds = getAppConfig().windowBounds;
  if (!bounds) return DEFAULT_WINDOW_BOUNDS;

  const width = Math.max(400, Math.round(bounds.width));
  const height = Math.max(300, Math.round(bounds.height));
  const savedBounds: WindowBounds = {
    width,
    height,
    isMaximized: bounds.isMaximized,
  };
  if (typeof bounds.x === "number") savedBounds.x = Math.round(bounds.x);
  if (typeof bounds.y === "number") savedBounds.y = Math.round(bounds.y);

  const nearestDisplay = screen.getDisplayMatching({
    x: savedBounds.x ?? 0,
    y: savedBounds.y ?? 0,
    width,
    height,
  });
  const { workArea } = nearestDisplay;
  const isVisible =
    typeof savedBounds.x !== "number" ||
    typeof savedBounds.y !== "number" ||
    (savedBounds.x < workArea.x + workArea.width &&
      savedBounds.x + width > workArea.x &&
      savedBounds.y < workArea.y + workArea.height &&
      savedBounds.y + height > workArea.y);

  return isVisible ? savedBounds : { width, height };
}

function saveWindowBounds(win: BrowserWindow) {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) {
    return;
  }

  const currentAppConfig = getAppConfig();
  const bounds = win.isMaximized()
    ? (currentAppConfig.windowBounds ?? DEFAULT_WINDOW_BOUNDS)
    : win.getBounds();
  const currentData = getUserData();
  currentData.app = {
    ...currentData.app,
    games: currentData.app?.games ?? [],
    windowBounds: {
      ...bounds,
      isMaximized: win.isMaximized(),
    },
  };
  fs.writeFileSync(
    path.join(app.getPath("userData"), "userData.json"),
    JSON.stringify(currentData, null, 2),
    "utf-8",
  );
}

function hookWindowBoundsPersistence(win: BrowserWindow) {
  let saveTimeout: NodeJS.Timeout | null = null;
  const queueSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => saveWindowBounds(win), 300);
  };

  win.on("resize", queueSave);
  win.on("move", queueSave);
  win.on("maximize", queueSave);
  win.on("unmaximize", queueSave);
  win.on("close", () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveWindowBounds(win);
  });
}

// let win: BrowserWindow;

function createWindow(): BrowserWindow {
  const localSession = getSession();
  const savedAppConfig = getAppConfig();
  const hasSavedWindowBounds = !!savedAppConfig.windowBounds;
  const savedBounds = getSavedWindowBounds();
  let win = new BrowserWindow({
    show: false,
    ...savedBounds,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      session: localSession,
    },
  });

  hookFullScreenEvents(win);
  hookWindowBoundsPersistence(win);
  hookExternalLinkHandling(win);

  // ── Applies fullscreen according to user config ──
  try {
    const cfg = getAppConfig();
    win.setFullScreen(cfg.fullScreenEnabled ?? false);
  } catch (e) {
    console.warn("[createWindow] Could not apply fullscreen :", e);
  }

  win.webContents.on("page-favicon-updated", (_event, favicons) => {
    if (!favicons.length) return;
    const faviconUrl = favicons[0];

    if (faviconUrl.startsWith("file://")) {
      try {
        const filePath = fileURLToPath(faviconUrl);
        const icon = nativeImage.createFromPath(filePath);
        if (!icon.isEmpty()) {
          win.setIcon(icon);
          console.log("[Favicon] Restored from local file :", filePath);
        } else {
          console.warn("[Favicon] nativeImage empty for:", filePath);
        }
      } catch (err) {
        console.warn("[Favicon] Could not resolve local URL:", faviconUrl, err);
      }
    } else {
      const request = net.request(faviconUrl);
      const chunks: Buffer[] = [];
      request.on("response", (response) => {
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const icon = nativeImage.createFromBuffer(buffer);
          if (!icon.isEmpty()) {
            win.setIcon(icon);
            console.log("[Favicon] Restored from external URL:", faviconUrl);
          }
        });
      });
      request.on("error", (err) =>
        console.warn("[Favicon] net.request error:", err),
      );
      request.end();
    }
  });

  // Fix Popouts
  win.webContents.setUserAgent(
    win.webContents.getUserAgent().replace("Electron", ""),
  );
  win.webContents.on("did-start-loading", () => {
    const wd = windowsData[win.webContents.id];
    if (wd?.selectedServerName) {
      win.setTitle(
        wd.selectedServerName +
          " - " +
          win.webContents.getTitle() +
          " * Loading...",
      );
    } else {
      win.setTitle(win.webContents.getTitle() + " * Loading...");
    }

    win.setProgressBar(2, { mode: "indeterminate" }); // second parameter optional
  });

  win.webContents.on("did-finish-load", () => {
    const wd = windowsData[win.webContents.id];
    if (wd?.selectedServerName) {
      win.setTitle(wd.selectedServerName + " - " + win.webContents.getTitle());
    } else {
      win.setTitle(win.webContents.getTitle());
    }
    win.setProgressBar(-1);
  });
  win.webContents.on("did-stop-loading", () => {
    const wd = windowsData[win.webContents.id];
    if (wd?.selectedServerName) {
      win.setTitle(wd.selectedServerName + " - " + win.webContents.getTitle());
    } else {
      win.setTitle(win.webContents.getTitle());
    }
    win.setProgressBar(-1);
  });
  win.menuBarVisible = false;
  if (!app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // EN PROD on pointe vers /renderer/<name>/index.html
    const indexHtml = path.join(
      __dirname,
      "../../renderer",
      MAIN_WINDOW_VITE_NAME,
      "index.html",
    );
    win.loadFile(indexHtml);
  }

  // ── Fallback on HTTP error (502, 503…) when loading /join ──
  const { session } = win.webContents;

  // Catch network errors (ERR_CONNECTION_REFUSED, etc.)
  session.webRequest.onErrorOccurred(
    { urls: ["*://*/join", "*://*/setup", "*://*/auth", "*://*/game"] },
    (details) => {
      if (
        details.resourceType === "mainFrame" &&
        !details.error.includes("ERR_ABORTED")
      ) {
        // on passe maintenant la fenêtre concernée
        handleServerError(win, details.url, details.error);
      }
    },
  );

  // Catch HTTP responses (502, 503, etc.)
  session.webRequest.onCompleted({ urls: ["*://*/*"] }, (details) => {
    if (details.resourceType === "mainFrame" && details.statusCode >= 400) {
      handleServerError(win, details.url, `HTTP ${details.statusCode}`);
    }
  });

  // Fallback + prompt function
  function handleServerError(
    targetWin: BrowserWindow,
    failedUrl: string,
    reason: string,
  ) {
    console.warn(`[App] Could not load ${failedUrl}: ${reason}`);
    // Return to index **dans la fenêtre concernée**
    returnToServerSelect(targetWin);
    // Affiche le prompt dans la bonne fenêtre
    targetWin.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        askPrompt(
          `The game you attempted to join could not be reached (${reason}).`,
          { mode: "alert" },
          targetWin,
        ).catch(console.error);
      }, 250);
    });
  }

  // Inject Server button on /game page
  win.webContents.on("did-start-navigation", (e) => {
    if (e.isSameDocument) return;
    if (e.url.startsWith("about")) return;

    if (e.url.endsWith("/game")) {
      console.log("[FVTT Client] Navigation detected: /game");

      win.webContents.executeJavaScript(`
                console.log("[FVTT Client] Injecting script for /game...");
    
                async function waitForFoundryReady() {
                    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                    while (typeof Hooks === "undefined" || typeof ui === "undefined") {
                        console.log("[FVTT Client] Waiting for Foundry...");
                        await wait(100);
                    }
    
                    console.log("[FVTT Client] Foundry ready, setting up Return button.");
                        Hooks.on('renderSettings', (settings, htmlElement) => {
                            const html = $(htmlElement);
                            const majorVersion = Number(game.version?.split(".")[0] ?? 0);
  
                            if (majorVersion >= 13) {
                                const serverSelectButton = $(\`
                                <a class="button">
                                <i class="fas fa-server" inert></i> Return to Server Select</a>
                                \`);
                                serverSelectButton.on('click', () => window.api.returnToServerSelect());
                                html.find("section.access.flexcol").append(serverSelectButton);
                                
                            } else {

                            if (html.find('#server-button').length > 0) return;
    
                            const serverSelectButton = $(\`
                                <button id="server-button" data-action="home">
                                    <i class="fas fa-server"></i> Return to Server Select
                                </button>
                            \`);
                            serverSelectButton.on('click', () => window.api.returnToServerSelect());
                            html.find('#settings-access').append(serverSelectButton);
                            }
                        });
                    }  
                waitForFoundryReady();
            `);
    }
  });

  win.webContents.on("did-finish-load", () => {
    const url = win.webContents.getURL();
    if (
      !url.endsWith("/join") &&
      !url.endsWith("/auth") &&
      !url.endsWith("/setup")
    )
      return;
    if (url.endsWith("/setup")) {
      win.webContents.executeJavaScript(`
                if ($('#server-button').length === 0) {
                    const serverSelectButton = $('<button type="button" class="icon" data-action="returnServerSelect" id="server-button" data-tooltip="Return to Server Select"><i class="fas fa-server"></i></button>');
                    serverSelectButton.on('click', () => window.api.returnToServerSelect());
                    setTimeout(() => {
                        $('div#setup-menu-buttons').append(serverSelectButton)
                    }, 1000);
                }
            `);
    }
    if (url.endsWith("/auth")) {
      win.webContents.executeJavaScript(`
                if ($('#server-button').length === 0) {
                    const serverSelectButton = $('<button type="button" class="bright" id="server-button"> <i class="fa-solid fa-server"></i>Return to Server Select</button>');
                    serverSelectButton.on('click', () => window.api.returnToServerSelect());
                    setTimeout(() => {
                        $('.form-footer').append(serverSelectButton)
                    }, 200);
                }
            `);
    }
    if (url.endsWith("/join")) {
      win.webContents.executeJavaScript(`
                if ($('#server-button').length === 0) {
                    const serverSelectButton = $('<button type="button" class="bright" id="server-button"> <i class="fa-solid fa-server"></i>Return to Server Select</button>');
                    serverSelectButton.on('click', () => window.api.returnToServerSelect());
                    setTimeout(() => {
                        $('.form-footer').append(serverSelectButton)
                    }, 200);
                }
            `);
    }

    if (!url.endsWith("/join") && !url.endsWith("/auth")) return;
    const userData = getLoginDetails(windowsData[win.webContents.id].gameId);
    if (!userData.user) return;
    win.webContents.executeJavaScript(`
            async function waitForLoad() {
                const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                while (!document.querySelector('select[name="userid"]') && !document.querySelector('input[name="adminPassword"]')) {
                    await wait(100);
                }
                console.log("logging in");
                login();
            }

            function login() {
                const adminPassword = document.querySelector('input[name="adminPassword"]');
                if (adminPassword)
                    adminPassword.value = "${userData.adminPassword}";
                const select = document.querySelector('select[name="userid"]');
                if (select)
                    select.querySelectorAll("option").forEach(opt => {
                        opt.selected = opt.innerText === "${userData.user}";
                    });
                const password = document.querySelector('input[name="password"]');
                if (password)
                    password.value = "${userData.password}";
                const fakeEvent = {
                    preventDefault: () => {
                    }, target: document.getElementById("join-game")
                }
                if (${windowsData[win.webContents.id].autoLogin}) {
                    ui.join._onSubmit(fakeEvent);
                } else {
                    document.querySelector(".form-footer button[name=join]").addEventListener("click", () => {
                        ui.join._onSubmit(fakeEvent);
                    });
                }
            }

            waitForLoad();

        `);
    windowsData[win.webContents.id].autoLogin = false;
  });

  win.once("ready-to-show", () => {
    if (!win.isFullScreen()) {
      if (savedAppConfig.windowBounds?.isMaximized ?? !hasSavedWindowBounds) {
        win.maximize();
      }
    }
    win.show();
  });
  win.on("closed", () => {
    windows.delete(win);
    win = null;
  });
  windows.add(win);
  windowsData[win.webContents.id] = { autoLogin: true } as WindowData;
  return win;
}

autoUpdater.on("checking-for-update", () => {
  if (initialCheckInProgress) {
    // silence the first “checking”
    return;
  }
  // any later “checking” should open the modal
  sendUpdateStatus("checking");
});

autoUpdater.on("update-available", (info) => {
  if (initialCheckInProgress) {
    // silence the first “available”
    return;
  }
  sendUpdateStatus("available", info, lastUpdateRequestingWindow);
});

autoUpdater.on("update-not-available", (info) => {
  if (initialCheckInProgress) {
    // silence the “no update” that always fires at the end of the startup check
    return;
  }
  sendUpdateStatus("not-available", info, lastUpdateRequestingWindow);
});
autoUpdater.on("download-progress", (progress) => {
  sendUpdateStatus("progress", progress, lastUpdateRequestingWindow);
});

let downloadedVersion: string | null = null;

autoUpdater.on("update-downloaded", (info) => {
  downloadedVersion = info.version;
  sendUpdateStatus("downloaded", info, lastUpdateRequestingWindow);
});

autoUpdater.on("error", (err) => {
  if (initialCheckInProgress) {
    // silence the first “available”
    return;
  }
  sendUpdateStatus(
    "error",
    {
      message: err == null ? "" : (err.stack || err).toString(),
    },
    lastUpdateRequestingWindow,
  );
});

app.whenReady().then(async () => {
  if (require("electron-squirrel-startup")) return;

  // File menu
  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "New Window",
        accelerator: "F8",
        click: () => {
          createWindow();
        },
      },
      { role: "quit" },
    ],
  };

  // View menu
  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { type: "separator" },
      {
        role: "resetZoom",
        accelerator: "CmdOrCtrl+Num0",
      },
      {
        role: "zoomIn",
        accelerator: "CmdOrCtrl+NumAdd",
      },
      {
        role: "zoomOut",
        accelerator: "CmdOrCtrl+NumSub",
      },
      {
        role: "resetZoom",
        visible: false,
      },
      {
        role: "zoomIn",
        visible: false,
      },
      {
        role: "zoomOut",
        visible: false,
      },
      { type: "separator" },
      {
        role: "togglefullscreen",
        accelerator: "F11",
      },
      { type: "separator" },

      // ── Reload & DevTools ──
      {
        role: "reload",
        visible: false,
      },
      {
        role: "reload",
        accelerator: "F5",
      },
      {
        role: "forceReload",
        visible: false,
      },
      {
        role: "forceReload",
        accelerator: "Ctrl+F5",
      },
      { type: "separator" },
      {
        role: "toggleDevTools",
        visible: false,
      },
      {
        role: "toggleDevTools",
        accelerator: "F12",
      },
    ],
  };

  // build and apply menu
  const menu = Menu.buildFromTemplate([fileMenu, viewMenu]);
  Menu.setApplicationMenu(menu);

  const migrationResult = await migrateUserData();

  // ── Detects first launch : userData.json missing ──
  const userDataPath = getUserDataPath();
  const isFirstUser = !fs.existsSync(userDataPath);

  mainWindow = createWindow();
  setUpdateWindow(mainWindow);

  // Configure cache/session
  const userData = getUserData();
  if (!isPortableWindows && userData.cachePath) {
    // make sure it’s absolute, e.g. under app.getPath('userData')
    const absoluteCachePath = path.isAbsolute(userData.cachePath)
      ? userData.cachePath
      : path.join(app.getPath("userData"), userData.cachePath);

    app.setPath("sessionData", absoluteCachePath);
  }

  // After rendering index, we notify on migration status
  mainWindow.webContents.once("did-finish-load", async () => {
    // only check once, right after launch
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        // result has a .updateInfo object
        const latest = result.updateInfo?.version;
        const current = app.getVersion();

        if (latest && latest !== current) {
          notifyMainWindow(`An update is available!`);
        }
      })
      .catch((err) => {
        console.error("Update‐check failed:", err);
        notifyMainWindow("Could not check for updates");
      })
      .finally(() => {
        // only once the promise settles do we turn off the “initial check” guard
        initialCheckInProgress = false;
      });

    if (migrationResult === "success") {
      notifyMainWindow(`Your user data has been successfully migrated`);
      console.log("Migration successful");
    } else if (migrationResult === "failure") {
      await askPrompt("Could not migrate your user data.", { mode: "alert" });
    }
    // Welcome, new users!
    if (isFirstUser) {
      const importedOriginalUserData =
        await promptImportOriginalUserData(mainWindow);
      if (importedOriginalUserData) return;

      notifyMainWindow(`Welcome!`);
    }
  });
});

ipcMain.handle("show-menu", () => {
  const w = BrowserWindow.getFocusedWindow();
  if (w) {
    Menu.getApplicationMenu()?.popup({ window: w });
  }
});

ipcMain.on("enable-discord-rpc", (event) => {
  startRichPresenceSocket();
  enableRichPresence(event.sender.id);
});

ipcMain.on("open-game", (e, gId, gameName: string) => {
  windowsData[e.sender.id].gameId = gId;
  windowsData[e.sender.id].selectedServerName = gameName;
});
ipcMain.on("clear-cache", async (event) => event.sender.session.clearCache());

ipcMain.on("save-user-data", (_e, data: SaveUserData) => {
  const { gameId, password, user, adminPassword } = data;
  saveUserData(gameId, {
    password:
      password.length !== 0
        ? Array.from(safeStorage.encryptString(password))
        : [],
    user,
    adminPassword:
      password.length !== 0
        ? Array.from(safeStorage.encryptString(adminPassword))
        : [],
  });
});
ipcMain.handle("get-user-data", (_, gameId: GameId) => getLoginDetails(gameId));

ipcMain.handle("app-version", () => app.getVersion());

ipcMain.handle("is-fullscreen", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.isFullScreen() : false;
});

ipcMain.on("close-window", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    win.close();
  }
});

ipcMain.handle("dialog:choose-font", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select a font file",
    filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
    properties: ["openFile"],
  });
  return canceled || filePaths.length === 0 ? null : filePaths[0];
});

ipcMain.handle("read-font-file", async (_e, fontPath: string) => {
  try {
    const buffer = fs.readFileSync(fontPath);
    return buffer.toString("base64");
  } catch (err) {
    console.error("read-font-file failed:", err);
    return null;
  }
});

function getAppConfig(): AppConfig {
  // Loads client data from userData.json
  try {
    const userData = getUserData();
    return userData.app ?? ({} as AppConfig);
  } catch {
    return {} as AppConfig;
  }
}

function getThemeConfig(): ThemeConfig {
  // Loads theme data from userData.json
  try {
    const userData = getUserData();
    return userData.theme ?? ({} as ThemeConfig);
  } catch {
    return {} as ThemeConfig;
  }
}

ipcMain.on("check-for-updates", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  lastUpdateRequestingWindow = win;
  sendUpdateStatus("checking", undefined, win);
  autoUpdater.checkForUpdates();
});
ipcMain.on("download-update", () => autoUpdater.downloadUpdate());
ipcMain.on("install-update", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const version = downloadedVersion ?? app.getVersion();
  if (process.platform === "linux") {
    const pkgTypeFile = path.join(process.resourcesPath, "package-type");
    let pkgType: string | undefined;
    try {
      if (fs.existsSync(pkgTypeFile)) {
        pkgType = fs.readFileSync(pkgTypeFile, "utf-8").trim();
        console.log("Detected package-type:", pkgType);
      }
    } catch (e) {
      console.warn("Could not read package-type:", e);
    }
    switch (pkgType) {
      case "deb": {
        sendUpdateStatus("installing", undefined, win);
        installDebUpdate(version);
        return;
      }
      case "rpm":
        break;
      case "pacman":
        break;
      default:
        break;
    }
  }
  // Windows / macOS / Linux RPM
  sendUpdateStatus("installing", undefined, win);
  autoUpdater.quitAndInstall(true, true);
});

ipcMain.on("save-app-config", (_e, data: AppConfig) => {
  const currentData = getUserData();
  currentData.app = { ...currentData.app, ...data };
  fs.writeFileSync(
    path.join(app.getPath("userData"), "userData.json"),
    JSON.stringify(currentData, null, 2),
    "utf-8",
  );
});
ipcMain.handle("app-config", getAppConfig);
ipcMain.handle("local-app-config", () => {
  try {
    const userData = getUserData();
    return userData.app ?? ({} as AppConfig);
  } catch {
    return {} as AppConfig;
  }
});

ipcMain.on("save-theme-config", (_e, data: ThemeConfig) => {
  const currentData = getUserData();
  currentData.theme = { ...currentData.theme, ...data };
  fs.writeFileSync(
    path.join(app.getPath("userData"), "userData.json"),
    JSON.stringify(currentData, null, 2),
    "utf-8",
  );
});
ipcMain.handle("theme-config", getThemeConfig);
ipcMain.handle("local-theme-config", () => {
  try {
    const userData = getUserData();
    return userData.theme ?? ({} as ThemeConfig);
  } catch {
    return {} as ThemeConfig;
  }
});

// TODO: Seems unused
/* ipcMain.handle("select-path", (e) => {
  windowsData[e.sender.id].autoLogin = true;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return MAIN_WINDOW_VITE_DEV_SERVER_URL;
  } else {
    return path.join(
      __dirname,
      `../../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
    );
  }
}); */

ipcMain.on("open-external", (_event, url: string) => {
  openUrlInDefaultBrowser(url);
});

ipcMain.handle("cache-path", () => app.getPath("sessionData"));

ipcMain.handle("open-user-data-folder", () => {
  const userDataDir = app.getPath("userData");
  return shell.openPath(userDataDir);
});

ipcMain.on("cache-path", (_, cachePath: string) => {
  const currentData = getUserData();
  currentData.cachePath = cachePath;
  fs.writeFileSync(
    path.join(app.getPath("userData"), "userData.json"),
    JSON.stringify(currentData, null, 2),
    "utf-8",
  );
});

type ServerBackgroundOptions = {
  gameId?: GameId;
  currentRemoteUrl?: string;
  currentLocalUrl?: string;
  force?: boolean;
};

type ServerBackgroundData = {
  remoteUrl: string;
  localUrl: string;
  fileName: string;
  updated: boolean;
  cleared?: boolean;
};

const serverBackgroundCache = new Map<string, string | null>();

function requestText(url: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error("Timeout"));
    }, timeoutMs);

    const chunks: Buffer[] = [];
    req.on("response", (response) => {
      response.on("data", (b) => chunks.push(b));
      response.on("end", () => {
        clearTimeout(timer);
        if (response.statusCode! >= 200 && response.statusCode! < 300) {
          resolve(Buffer.concat(chunks).toString("utf-8"));
          return;
        }
        reject(new Error(`HTTP ${response.statusCode}`));
      });
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

function requestBuffer(
  url: string,
  timeoutMs = 10000,
): Promise<{ buffer: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const req = net.request(url);
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error("Timeout"));
    }, timeoutMs);

    const chunks: Buffer[] = [];
    req.on("response", (response) => {
      response.on("data", (b) => chunks.push(b));
      response.on("end", () => {
        clearTimeout(timer);
        if (response.statusCode! >= 200 && response.statusCode! < 300) {
          const header = response.headers["content-type"];
          const contentType = Array.isArray(header)
            ? header[0]
            : (header ?? "");
          resolve({ buffer: Buffer.concat(chunks), contentType });
          return;
        }
        reject(new Error(`HTTP ${response.statusCode}`));
      });
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
}

function extractFoundryBackgroundUrl(html: string, pageUrl: string) {
  const customPropertyMatch = html.match(
    /--background-url\s*:\s*url\(\s*(['"]?)([^'")]+)\1\s*\)/i,
  );
  const backgroundMatch =
    customPropertyMatch ??
    html.match(/background(?:-image)?\s*:\s*url\(\s*(['"]?)([^'")]+)\1\s*\)/i);
  const backgroundPath = backgroundMatch?.[2]?.trim();
  if (!backgroundPath || backgroundPath.startsWith("data:")) return null;

  try {
    return new URL(backgroundPath, pageUrl).toString();
  } catch {
    return null;
  }
}

function getImageExtension(url: string, contentType: string) {
  const normalizedContentType = contentType.split(";")[0].trim().toLowerCase();
  const contentTypeExtensions: Record<string, string> = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
  };
  if (contentTypeExtensions[normalizedContentType]) {
    return contentTypeExtensions[normalizedContentType];
  }

  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (
      [".avif", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].includes(ext)
    ) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    // Fall through to a safe default.
  }

  return ".webp";
}

function getLocalPathFromFileUrl(fileUrl?: string) {
  if (!fileUrl) return null;
  try {
    return fileURLToPath(fileUrl);
  } catch {
    return null;
  }
}

function getServerBackgroundsDir() {
  return path.join(app.getPath("userData"), "server-backgrounds");
}

function removeLocalServerBackground(fileUrl?: string) {
  const filePath = getLocalPathFromFileUrl(fileUrl);
  if (!filePath) return;

  const backgroundsDir = path.resolve(getServerBackgroundsDir());
  const resolvedFilePath = path.resolve(filePath);
  if (path.dirname(resolvedFilePath) !== backgroundsDir) return;

  fs.removeSync(resolvedFilePath);
}

function getServerBackgroundFilename(
  gameId: GameId | undefined,
  remoteUrl: string,
) {
  const source = String(gameId ?? remoteUrl);
  return source.replace(/[^a-z0-9_-]/gi, "_").slice(0, 80) || "server";
}

async function downloadServerBackground(
  remoteUrl: string,
  gameId: GameId | undefined,
) {
  const { buffer, contentType } = await requestBuffer(remoteUrl);
  const backgroundsDir = getServerBackgroundsDir();
  const filename = `${getServerBackgroundFilename(
    gameId,
    remoteUrl,
  )}${getImageExtension(remoteUrl, contentType)}`;
  const filePath = path.join(backgroundsDir, filename);

  fs.ensureDirSync(backgroundsDir);
  fs.writeFileSync(filePath, buffer);
  return {
    fileName: filename,
    localUrl: pathToFileURL(filePath).toString(),
  };
}

ipcMain.handle("server-background-local-url", (_e, fileName: string) => {
  const safeFileName = path.basename(fileName);
  const filePath = path.join(getServerBackgroundsDir(), safeFileName);
  if (!fs.pathExistsSync(filePath)) return null;
  return pathToFileURL(filePath).toString();
});

ipcMain.handle(
  "server-background",
  async (
    _e,
    rawUrl: string,
    options: ServerBackgroundOptions = {},
  ): Promise<ServerBackgroundData | null> => {
    if (serverBackgroundCache.has(rawUrl)) {
      const cachedRemoteUrl = serverBackgroundCache.get(rawUrl);
      const cachedLocalPath = getLocalPathFromFileUrl(options.currentLocalUrl);
      if (
        cachedRemoteUrl &&
        cachedRemoteUrl === options.currentRemoteUrl &&
        options.currentLocalUrl &&
        cachedLocalPath &&
        fs.pathExistsSync(cachedLocalPath) &&
        !options.force
      ) {
        return {
          remoteUrl: cachedRemoteUrl,
          localUrl: options.currentLocalUrl,
          fileName: path.basename(cachedLocalPath),
          updated: false,
        };
      }
    }

    let urls: string[];
    try {
      urls = Array.from(new Set([rawUrl, new URL("join", rawUrl).toString()]));
    } catch {
      return null;
    }

    let reachedServerWithoutBackground = false;

    for (const url of urls) {
      try {
        const html = await requestText(url);
        reachedServerWithoutBackground = true;
        const backgroundUrl = extractFoundryBackgroundUrl(html, url);
        if (backgroundUrl) {
          const currentLocalPath = getLocalPathFromFileUrl(
            options.currentLocalUrl,
          );
          if (
            backgroundUrl === options.currentRemoteUrl &&
            options.currentLocalUrl &&
            currentLocalPath &&
            fs.pathExistsSync(currentLocalPath) &&
            !options.force
          ) {
            serverBackgroundCache.set(rawUrl, backgroundUrl);
            return {
              remoteUrl: backgroundUrl,
              localUrl: options.currentLocalUrl,
              fileName: path.basename(currentLocalPath),
              updated: false,
            };
          }

          const downloadedBackground = await downloadServerBackground(
            backgroundUrl,
            options.gameId,
          );
          serverBackgroundCache.set(rawUrl, backgroundUrl);
          return {
            remoteUrl: backgroundUrl,
            localUrl: downloadedBackground.localUrl,
            fileName: downloadedBackground.fileName,
            updated: true,
          };
        }
      } catch (err) {
        console.warn("[Server Background] Failed to inspect", url, err);
      }
    }

    serverBackgroundCache.set(rawUrl, null);
    if (reachedServerWithoutBackground) {
      removeLocalServerBackground(options.currentLocalUrl);
      return {
        remoteUrl: "",
        localUrl: "",
        fileName: "",
        updated: true,
        cleared: true,
      };
    }

    return null;
  },
);

ipcMain.handle("ping-server", (_e, rawUrl: string) => {
  return new Promise<ServerStatusData | null>((resolve, reject) => {
    const pingUrl = new URL("api/status", rawUrl).toString();

    // fire the request
    const req = net.request(pingUrl);

    // enforce a 5s timeout
    const timer = setTimeout(() => {
      req.abort();
      reject(new Error("Timeout"));
    }, 5000);

    const chunks: Buffer[] = [];
    req.on("response", (response) => {
      clearTimeout(timer);

      // accumulate all data
      response.on("data", (b) => chunks.push(b));
      response.on("end", () => {
        // only parse on 2xx
        if (response.statusCode! >= 200 && response.statusCode! < 300) {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString());
            resolve(json);
          } catch {
            reject(new Error("Invalid JSON"));
          }
        } else {
          reject(new Error(`HTTP ${response.statusCode}`));
        }
      });
    });

    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end();
  });
});

ipcMain.on("return-select", (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) returnToServerSelect(win);
});

app.on("activate", (_, hasVisibleWindows) => {
  if (!hasVisibleWindows) {
    createWindow();
  }
});

ipcMain.on("set-fullscreen", (event, fullscreen: boolean) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (w) w.setFullScreen(fullscreen);
  if (w && fullscreen) w.maximize();
});

app.on("window-all-closed", () => {
  app.quit();
});

function getLoginDetails(gameId: GameId): GameUserDataDecrypted {
  const userData = getUserData()[gameId];
  if (!userData) return { user: "", password: "", adminPassword: "" };
  const password = new Uint8Array(userData.password);
  const adminPassword = new Uint8Array(userData.adminPassword);

  return {
    user: userData.user,
    password:
      password.length !== 0
        ? safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(password))
          : ""
        : "",
    adminPassword:
      password.length !== 0
        ? safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(adminPassword))
          : ""
        : "",
  };
}

function writeUserDataFile(data: unknown) {
  const result = UserDataSchema.safeParse(data);
  if (!result.success) {
    console.error("Invalid write attempt :", result.error.format());
    return false;
  }
  fs.writeFileSync(
    path.join(app.getPath("userData"), "userData.json"),
    JSON.stringify(result.data, null, 2),
    "utf-8",
  );
  return true;
}

function saveUserData(gameId: GameId, data: GameUserData) {
  const current = getUserData();
  const newData: UserData = { ...current, [gameId]: data };
  if (!writeUserDataFile(newData)) {
    askPrompt(`Unable to write userData. Data could not be saved.`, {
      mode: "alert",
    });
    console.warn("Unable to write userData. Data could not be saved.");
  }
}
