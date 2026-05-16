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
  protocol,
} from "electron";
import {
  UserDataSchema,
  ThemeConfigSchema,
  AppConfigSchema,
  GameUserDataSchema,
  UserData,
  AppConfig,
  FavoriteConfig,
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
import os from "os";
import { fileURLToPath, pathToFileURL } from "url";
import { execFile } from "child_process";
import crypto from "crypto";
import log from "electron-log";
import { autoUpdater } from "electron-updater";
import { installDebUpdate } from "./utils/installUpdate";
import { sendUpdateStatus, setUpdateWindow } from "./utils/updateStatus";
import { extractImportedLoginRecords } from "./utils/importLoginRecords";
import type { ImportedLoginRecord } from "./utils/importLoginRecords";

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
const isDev = !app.isPackaged;

let initialCheckInProgress = true;

if (require("electron-squirrel-startup")) app.quit();

// workaround for gtk version preventing app launch on certain Linux distros while using Electron 36
app.commandLine.appendSwitch("gtk-version", "3");

app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

try {
  if (getAppConfig().disableHardwareAcceleration ?? false) {
    app.disableHardwareAcceleration();
    log.info("[diagnostics] Hardware acceleration disabled by client setting");
  } else {
    app.commandLine.appendSwitch("force_high_performance_gpu");
  }
} catch (err) {
  log.warn("[diagnostics] Could not read hardware acceleration setting", err);
  app.commandLine.appendSwitch("force_high_performance_gpu");
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "ve-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);

/* Remove the comment (//) from the line below to ignore certificate errors (useful for self-signed certificates) */

//app.commandLine.appendSwitch("ignore-certificate-errors");

let mainWindow: BrowserWindow;
let lastUpdateRequestingWindow: BrowserWindow | null = null;
let favoritesPopupWindow: BrowserWindow | null = null;

const DEFAULT_WINDOW_BOUNDS: WindowBounds = {
  width: 800,
  height: 600,
};

function fitBoundsToWorkArea(bounds: WindowBounds): WindowBounds {
  const nearestDisplay = screen.getDisplayMatching({
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
    width: bounds.width,
    height: bounds.height,
  });
  const { workArea } = nearestDisplay;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const fitted: WindowBounds = {
    ...bounds,
    width,
    height,
  };

  if (typeof fitted.x === "number") {
    fitted.x = Math.min(
      Math.max(fitted.x, workArea.x),
      workArea.x + workArea.width - width,
    );
  }
  if (typeof fitted.y === "number") {
    fitted.y = Math.min(
      Math.max(fitted.y, workArea.y),
      workArea.y + workArea.height - height,
    );
  }

  return fitted;
}

const ORIGINAL_APP_USER_DATA_DIR_NAMES = [
  "FVTT Desktop Client",
  "FVTT Player Client",
  "VTT Desktop Client",
  "fvtt-player-client",
  "vtt-desktop-client",
  "vtt_desktop_client",
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

type OriginalAppUninstallCandidate = {
  appName: string;
  executablePath: string;
  args?: string[];
};

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

function updateUserDataFile(task: (data: UserData) => void) {
  const data = getUserData();
  task(data);
  fs.writeFileSync(getUserDataPath(), JSON.stringify(data, null, 2), "utf-8");
}

function markOriginalImportDeclined(candidate: OriginalUserDataCandidate) {
  updateUserDataFile((data) => {
    data.originalImportDeclinedAt = new Date().toISOString();
    data.originalImportDeclinedAppName = candidate.appName;
  });
}

function markOriginalImportCompleted(candidate: OriginalUserDataCandidate) {
  updateUserDataFile((data) => {
    data.originalImportCompletedAt = new Date().toISOString();
    data.originalImportCompletedAppName = candidate.appName;
  });
}

function markOriginalUninstallDeclined(
  candidate: OriginalAppUninstallCandidate,
) {
  updateUserDataFile((data) => {
    data.originalUninstallDeclinedAt = new Date().toISOString();
    data.originalUninstallDeclinedAppName = candidate.appName;
  });
}

function getOriginalAppUninstallCandidates(): OriginalAppUninstallCandidate[] {
  const candidates: OriginalAppUninstallCandidate[] = [];

  if (process.env.LOCALAPPDATA) {
    candidates.push(
      {
        appName: "VTT Desktop Client",
        executablePath: path.join(
          process.env.LOCALAPPDATA,
          "vtt_desktop_client",
          "Update.exe",
        ),
        args: ["--uninstall", "-s"],
      },
      {
        appName: "FVTT Desktop Client",
        executablePath: path.join(
          process.env.LOCALAPPDATA,
          "Programs",
          "FVTT Desktop Client",
          "Uninstall FVTT Desktop Client.exe",
        ),
      },
    );
  }

  const programFilesRoots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env["ProgramFiles(x86)"],
  ].filter((root): root is string => !!root);

  for (const root of programFilesRoots) {
    candidates.push({
      appName: "FVTT Desktop Client",
      executablePath: path.join(
        root,
        "FVTT Desktop Client",
        "Uninstall FVTT Desktop Client.exe",
      ),
    });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalizedPath = normalizePathForCompare(candidate.executablePath);
    if (seen.has(normalizedPath)) return false;
    seen.add(normalizedPath);
    return true;
  });
}

function getOriginalAppUninstallCandidate() {
  return (
    getOriginalAppUninstallCandidates().find((candidate) =>
      fs.pathExistsSync(candidate.executablePath),
    ) ?? null
  );
}

function runOriginalAppUninstaller(candidate: OriginalAppUninstallCandidate) {
  return new Promise<void>((resolve, reject) => {
    execFile(candidate.executablePath, candidate.args ?? [], (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function promptUninstallOriginalApp(win: BrowserWindow) {
  if (process.platform !== "win32") return;

  const candidate = getOriginalAppUninstallCandidate();
  if (!candidate) return;

  const currentData = getUserData();
  if (currentData.originalUninstallDeclinedAt) return;

  const shouldUninstall = await askPrompt(
    "Settings were imported into VE Foundry Client. You can now uninstall the original app if you no longer need it.",
    undefined,
    win,
  );
  if (!shouldUninstall) {
    markOriginalUninstallDeclined(candidate);
    return;
  }

  try {
    await runOriginalAppUninstaller(candidate);
    notifyMainWindow(`${candidate.appName} uninstall started`, win);
  } catch (e) {
    console.warn("[installer] Original app uninstall failed:", e);
    await askPrompt(
      `Could not start the ${candidate.appName} uninstaller.`,
      { mode: "alert" },
      win,
    );
  }
}

function createPreImportBackup() {
  const userDataPath = getUserDataPath();
  if (!fs.pathExistsSync(userDataPath)) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    app.getPath("userData"),
    `userData.before-original-import.${timestamp}.json`,
  );
  fs.copyFileSync(userDataPath, backupPath);
  return backupPath;
}

function getImportSuccessMessage(
  candidate: OriginalUserDataCandidate,
  importedData: UserData,
) {
  const servers = importedData.app?.games ?? [];
  const serverCount = servers.length;
  const serverText = serverCount === 1 ? "1 server" : `${serverCount} servers`;
  const serverNames = servers
    .map((server) => server.name)
    .filter((name): name is string => !!name?.trim());
  const listedNames = serverNames.slice(0, 8).join(", ");
  const remainingCount = serverNames.length - 8;
  const namesText =
    listedNames && remainingCount > 0
      ? `: ${listedNames}, and ${remainingCount} more`
      : listedNames
        ? `: ${listedNames}`
        : "";
  return `Imported ${serverText} and theme settings from ${candidate.appName}${namesText}`;
}

function shouldOfferOriginalUserDataImport() {
  const candidate = getOriginalUserDataCandidate();
  if (!candidate) return null;

  const currentData = getUserData();
  if (
    currentData.originalImportDeclinedAt ||
    currentData.originalImportCompletedAt
  ) {
    return null;
  }

  const currentServerCount = currentData.app?.games?.length ?? 0;
  if (currentServerCount > 0) return null;

  return candidate;
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

  Object.assign(
    importedData,
    extractImportedLoginRecords(data, importedData.app?.games ?? []),
  );

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
  const candidate = shouldOfferOriginalUserDataImport();
  if (!candidate) return false;

  const shouldImport = await askPrompt(
    `Saved settings from ${candidate.appName} were found. Import servers, themes, and login details into VE Foundry Client?`,
    undefined,
    win,
  );
  if (!shouldImport) {
    markOriginalImportDeclined(candidate);
    return false;
  }

  try {
    const rawData = JSON.parse(
      fs.readFileSync(candidate.userDataPath, "utf-8"),
    );
    const importedData = prepareImportedUserData(rawData);
    createPreImportBackup();
    fs.ensureDirSync(app.getPath("userData"));
    fs.writeFileSync(
      getUserDataPath(),
      JSON.stringify(importedData, null, 2),
      "utf-8",
    );
    const importSuccessMessage = getImportSuccessMessage(
      candidate,
      importedData,
    );
    notifyMainWindow(importSuccessMessage, win);
    markOriginalImportCompleted(candidate);
    await askPrompt(importSuccessMessage, { mode: "alert" }, win);
    await promptUninstallOriginalApp(win);
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

function openUrlInAppWindow(url: string, parent?: BrowserWindow | null) {
  const child = new BrowserWindow({
    width: 1024,
    height: 768,
    parent: parent ?? undefined,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  hookMenuShortcut(child);
  hookFavoritePopupShortcut(child);
  hookExternalLinkHandling(child);
  child.loadURL(url);
}

function isFileFavorite(favorite: FavoriteConfig) {
  return favorite.type === "file" || (!!favorite.filePath && !favorite.url);
}

function getFavoriteTarget(favorite: FavoriteConfig) {
  return isFileFavorite(favorite)
    ? (favorite.filePath ?? "")
    : (favorite.url ?? "");
}

function getPopupImageUrl(imageUrl?: string) {
  if (!imageUrl?.startsWith("file://")) return imageUrl;

  try {
    const image = nativeImage.createFromPath(fileURLToPath(imageUrl));
    return image.isEmpty() ? imageUrl : image.toDataURL();
  } catch (err) {
    console.error("Could not prepare favorite popup icon:", err);
    return imageUrl;
  }
}

function getFavoriteLabels() {
  const commonwealthLocales = new Set([
    "au",
    "gb",
    "ie",
    "nz",
    "za",
    "ca",
    "in",
  ]);
  const localeParts = app.getLocale().toLowerCase().split("-");
  const region = localeParts[1];
  const usesCommonwealthEnglish = region
    ? commonwealthLocales.has(region)
    : false;

  return usesCommonwealthEnglish
    ? { singular: "Favourite", plural: "Favourites" }
    : { singular: "Favorite", plural: "Favorites" };
}

function showFavoritesPopup(parent?: BrowserWindow | null) {
  if (favoritesPopupWindow && !favoritesPopupWindow.isDestroyed()) {
    favoritesPopupWindow.close();
    return;
  }

  const favorites = (getAppConfig().favorites ?? [])
    .filter((favorite) => Boolean(getFavoriteTarget(favorite)))
    .map((favorite) => ({
      ...favorite,
      iconOverrideUrl: getPopupImageUrl(favorite.iconOverrideUrl),
    }));
  const favoriteLabels = getFavoriteLabels();
  const popup = new BrowserWindow({
    width: 520,
    height: 460,
    parent: parent ?? undefined,
    modal: !!parent,
    title: favoriteLabels.plural,
    autoHideMenuBar: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  favoritesPopupWindow = popup;
  hookMenuShortcut(popup);
  popup.on("closed", () => {
    if (favoritesPopupWindow === popup) {
      favoritesPopupWindow = null;
    }
  });

  const data = JSON.stringify(favorites);
  const labels = JSON.stringify(favoriteLabels);
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${favoriteLabels.plural}</title>
  <style>
    :root { color-scheme: dark; }
    body {
      background: #101722;
      color: #f3edc8;
      font-family: Georgia, "Times New Roman", serif;
      margin: 0;
      overflow-x: hidden;
      padding: 1rem;
    }
    h1 {
      font-size: 1.35rem;
      letter-spacing: 0.04em;
      margin: 0 0 0.75rem;
      text-align: center;
    }
    .hint {
      color: rgba(243, 237, 200, 0.72);
      font-size: 0.82rem;
      margin: -0.35rem 0 0.9rem;
      text-align: center;
    }
    .list {
      display: grid;
      gap: 0.55rem;
      max-height: 20.5rem;
      overflow-x: hidden;
      overflow-y: auto;
      padding-right: 0.25rem;
    }
    button {
      align-items: center;
      background: rgba(20, 20, 30, 0.82);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      color: #f3edc8;
      cursor: pointer;
      display: grid;
      gap: 0.7rem;
      grid-template-columns: 2.25rem 1fr;
      min-height: 3.75rem;
      min-width: 0;
      padding: 0.55rem 0.7rem;
      text-align: left;
      width: 100%;
    }
    button:hover {
      background: rgba(38, 42, 56, 0.94);
      box-shadow: 0 0 8px rgba(255, 139, 0, 0.55);
    }
    .icon {
      align-items: center;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 7px;
      display: flex;
      height: 2.25rem;
      justify-content: center;
      overflow: hidden;
      width: 2.25rem;
    }
    .icon img {
      height: 100%;
      object-fit: cover;
      width: 100%;
    }
    .name {
      display: block;
      font-size: 1rem;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .target {
      color: rgba(243, 237, 200, 0.72);
      display: block;
      font-size: 0.78rem;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      color: rgba(243, 237, 200, 0.72);
      margin-top: 4rem;
      text-align: center;
    }
    .text {
      min-width: 0;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <h1>${favoriteLabels.plural}</h1>
  <p class="hint">Ctrl+Shift+F toggles this popup from any client window.</p>
  <div id="list" class="list"></div>
  <script>
    const favorites = ${data};
    const favoriteLabels = ${labels};
    const list = document.getElementById("list");
    const isFileFavorite = (favorite) => favorite.type === "file" || (!!favorite.filePath && !favorite.url);
    const target = (favorite) => isFileFavorite(favorite) ? favorite.filePath : favorite.url;
    const getFaviconUrl = (url) => {
      if (!url) return "";
      try {
        const parsed = new URL(url);
        return "https://www.google.com/s2/favicons?domain_url=" + encodeURIComponent(parsed.origin) + "&sz=64";
      } catch {
        return "";
      }
    };
    const getWebsiteSnapshotUrl = (url) => {
      if (!url) return "";
      try {
        const parsed = new URL(url);
        return "https://api.microlink.io/?url=" + encodeURIComponent(parsed.href) + "&screenshot=true&embed=screenshot.url";
      } catch {
        return "";
      }
    };
    if (!favorites.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No " + favoriteLabels.plural.toLowerCase() + " have been added yet.";
      list.replaceWith(empty);
    }
    favorites.forEach((favorite) => {
      const button = document.createElement("button");
      button.type = "button";
      const icon = document.createElement("span");
      icon.className = "icon";
      const faviconUrl = !isFileFavorite(favorite) ? (favorite.iconUrl || getFaviconUrl(target(favorite))) : "";
      const imageUrl = favorite.iconOverrideUrl || faviconUrl;
      if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "";
        img.addEventListener("error", () => {
          if (!img.dataset.triedDefaultIcon && favorite.iconOverrideUrl && faviconUrl) {
            img.dataset.triedDefaultIcon = "true";
            img.src = faviconUrl;
            return;
          }
          if (!img.dataset.triedFileIcon && favorite.iconOverrideUrl && isFileFavorite(favorite) && target(favorite)) {
            img.dataset.triedFileIcon = "true";
            window.api.localFileIcon(target(favorite)).then((iconUrl) => {
              if (iconUrl) {
                img.src = iconUrl;
                return;
              }
              img.remove();
              icon.textContent = "file";
            });
            return;
          }
          const snapshotUrl = getWebsiteSnapshotUrl(target(favorite));
          if (!img.dataset.triedSnapshot && snapshotUrl) {
            img.dataset.triedSnapshot = "true";
            img.src = snapshotUrl;
            return;
          }
          img.remove();
          icon.textContent = isFileFavorite(favorite) ? "file" : (favorite.name || "?").charAt(0).toUpperCase();
        });
        icon.append(img);
      } else if (isFileFavorite(favorite) && target(favorite)) {
        window.api.localFileIcon(target(favorite)).then((iconUrl) => {
          if (!iconUrl) {
            icon.textContent = "file";
            return;
          }
          const img = document.createElement("img");
          img.src = iconUrl;
          img.alt = "";
          img.addEventListener("error", () => {
            img.remove();
            icon.textContent = "file";
          });
          icon.replaceChildren(img);
        });
      } else {
        icon.textContent = isFileFavorite(favorite) ? "file" : (favorite.name || "?").charAt(0).toUpperCase();
      }
      const text = document.createElement("span");
      text.className = "text";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = favorite.name || favoriteLabels.singular;
      const targetText = document.createElement("span");
      targetText.className = "target";
      targetText.textContent = target(favorite) || "";
      text.append(name, targetText);
      button.append(icon, text);
      button.addEventListener("click", () => {
        const value = target(favorite);
        if (!value) return;
        if (isFileFavorite(favorite)) {
          window.api.openLocalPath(value);
        } else {
          window.api.openDefaultBrowser(value);
        }
        window.api.closeWindow();
      });
      list.append(button);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") window.api.closeWindow();
    });
  </script>
</body>
</html>`;

  popup.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function hookExternalLinkHandling(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const openExternalLinksInBrowser =
      getAppConfig().externalLinksInDefaultBrowser ?? true;
    if (
      openExternalLinksInBrowser &&
      shouldOpenInExternalBrowser(win.webContents.getURL(), url)
    ) {
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
    const openExternalLinksInBrowser =
      getAppConfig().externalLinksInDefaultBrowser ?? true;
    if (
      !openExternalLinksInBrowser ||
      !shouldOpenInExternalBrowser(win.webContents.getURL(), url)
    ) {
      return;
    }

    event.preventDefault();
    openUrlInDefaultBrowser(url);
  });

  win.webContents.on("did-create-window", (childWindow) => {
    hookMenuShortcut(childWindow);
    hookExternalLinkHandling(childWindow);
    hookFavoritePopupShortcut(childWindow);
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

function showApplicationMenu(win?: BrowserWindow | null) {
  const targetWindow = win ?? BrowserWindow.getFocusedWindow();
  if (targetWindow && !targetWindow.isDestroyed()) {
    Menu.getApplicationMenu()?.popup({ window: targetWindow });
  }
}

function hookMenuShortcut(win: BrowserWindow) {
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.key === "F1" &&
      !input.alt &&
      !input.control &&
      !input.meta &&
      !input.shift
    ) {
      event.preventDefault();
      showApplicationMenu(win);
    }
  });
}

function hookFavoritePopupShortcut(win: BrowserWindow) {
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      input.control &&
      input.shift &&
      input.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      showFavoritesPopup(win);
    }

    if (
      input.type === "keyDown" &&
      input.control &&
      input.shift &&
      input.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      returnToServerSelect(win);
    }
  });
}

function getFocusedClientWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (
    focused &&
    favoritesPopupWindow &&
    focused.id === favoritesPopupWindow.id
  ) {
    return mainWindow;
  }
  return focused ?? mainWindow;
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

  return fitBoundsToWorkArea(isVisible ? savedBounds : { width, height });
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
  hookMenuShortcut(win);
  hookWindowBoundsPersistence(win);
  hookExternalLinkHandling(win);
  hookFavoritePopupShortcut(win);
  attachWindowDiagnostics(win, "main-foundry-window");

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
    const loginPayload = JSON.stringify({
      user: userData.user,
      password: userData.password,
      adminPassword: userData.adminPassword,
      autoLogin: windowsData[win.webContents.id].autoLogin,
    });
    win.webContents.executeJavaScript(`
      (() => {
        const credentials = ${loginPayload};
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        function setFieldValue(field, value) {
          if (!field) return;
          field.value = value ?? "";
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function selectUser(select, userName) {
          if (!select) return;
          const normalizedUserName = String(userName).trim();
          const option = Array.from(select.options).find((opt) => {
            return (
              opt.textContent?.trim() === normalizedUserName ||
              opt.label?.trim() === normalizedUserName ||
              opt.value === normalizedUserName
            );
          });
          if (option) {
            select.value = option.value;
            select.dispatchEvent(new Event("input", { bubbles: true }));
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }

        function findSubmitButton() {
          return document.querySelector(
            [
              'button[name="join"]',
              'button[data-action="join"]',
              '#join-game button[type="submit"]',
              '#join-game button',
              'form button[type="submit"]',
              'button[type="submit"]',
            ].join(","),
          );
        }

        function submitLogin() {
          const button = findSubmitButton();
          const form =
            button?.closest("form") ??
            document.querySelector("#join-game") ??
            document.querySelector("form");

          if (form instanceof HTMLFormElement) {
            if (typeof form.requestSubmit === "function") {
              form.requestSubmit(button instanceof HTMLElement ? button : undefined);
              return true;
            }
            form.dispatchEvent(
              new Event("submit", { bubbles: true, cancelable: true }),
            );
            return true;
          }

          if (button instanceof HTMLElement) {
            button.click();
            return true;
          }

          if (typeof ui?.join?._onSubmit === "function") {
            ui.join._onSubmit({
              preventDefault() {},
              target: document.getElementById("join-game") ?? document,
            });
            return true;
          }

          return false;
        }

        async function waitForLoginFields() {
          for (let i = 0; i < 150; i += 1) {
            if (
              document.querySelector(
                [
                  'select[name="userid"]',
                  'select[name="user"]',
                  'input[name="userid"]',
                  'input[name="user"]',
                  'input[name="password"]',
                  'input[name="adminPassword"]',
                ].join(","),
              )
            ) {
              return true;
            }
            await wait(100);
          }
          return false;
        }

        async function login() {
          const fieldsFound = await waitForLoginFields();
          if (!fieldsFound) return;

          setFieldValue(
            document.querySelector('input[name="adminPassword"]'),
            credentials.adminPassword,
          );
          selectUser(
            document.querySelector('select[name="userid"], select[name="user"]'),
            credentials.user,
          );
          setFieldValue(
            document.querySelector('input[name="userid"], input[name="user"]'),
            credentials.user,
          );
          setFieldValue(
            document.querySelector('input[name="password"]'),
            credentials.password,
          );

          if (credentials.autoLogin) {
            await wait(75);
            submitLogin();
          }
        }

        login();
      })();
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
  let clearingCacheBeforeClose = false;
  win.on("close", (event) => {
    if (clearingCacheBeforeClose || !getAppConfig().autoCacheClear) return;
    event.preventDefault();
    clearingCacheBeforeClose = true;
    win.webContents.session
      .clearCache()
      .catch((err) => {
        console.warn("[cache] Could not clear cache on close:", err);
      })
      .finally(() => {
        if (!win.isDestroyed()) win.destroy();
      });
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

async function enrichUpdateInfoWithReleaseNotes(info: any) {
  try {
    const releaseText = await requestText(
      "https://api.github.com/repos/Silvestrae/ve-foundry-client/releases/latest",
      8000,
    );
    const release = JSON.parse(releaseText);
    return {
      ...info,
      version:
        info?.version ?? String(release?.tag_name ?? "").replace(/^v/, ""),
      releaseNotes: release?.body ?? info?.releaseNotes,
      releaseName: release?.name ?? info?.releaseName,
      releaseDate: release?.published_at ?? info?.releaseDate,
    };
  } catch (err) {
    console.warn("[updater] Could not fetch latest release notes:", err);
    return info;
  }
}

autoUpdater.on("update-available", (info) => {
  if (initialCheckInProgress) {
    // silence the first “available”
    return;
  }
  void enrichUpdateInfoWithReleaseNotes(info).then((payload) => {
    sendUpdateStatus("available", payload, lastUpdateRequestingWindow);
  });
});

autoUpdater.on("update-not-available", (info) => {
  if (initialCheckInProgress) {
    // silence the “no update” that always fires at the end of the startup check
    return;
  }
  void enrichUpdateInfoWithReleaseNotes(info).then((payload) => {
    sendUpdateStatus("not-available", payload, lastUpdateRequestingWindow);
  });
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

function isChromiumDiagnosticsEnabled() {
  try {
    return getAppConfig().chromiumDiagnosticsEnabled ?? false;
  } catch {
    return false;
  }
}

function getWindowDiagnosticDetails(win?: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return {};
  return {
    windowId: win.id,
    webContentsId: win.webContents.id,
    title: win.getTitle(),
    url: win.webContents.getURL(),
  };
}

const CHROMIUM_DIAGNOSTICS_LOG_FILE = "chromium-diagnostics.log";
const CHROMIUM_DIAGNOSTICS_MAX_BYTES = 5 * 1024 * 1024;
const CHROMIUM_DIAGNOSTICS_FLUSH_MS = 2000;
const CHROMIUM_DIAGNOSTICS_MAX_QUEUE = 1000;
const CHROMIUM_DIAGNOSTICS_MAX_FIELD_LENGTH = 4000;

const chromiumDiagnosticsQueue: string[] = [];
let chromiumDiagnosticsFlushTimer: NodeJS.Timeout | null = null;
let chromiumDiagnosticsFlushInProgress = false;
let chromiumDiagnosticsDropped = 0;

function getChromiumDiagnosticsLogPath() {
  return path.join(app.getPath("userData"), CHROMIUM_DIAGNOSTICS_LOG_FILE);
}

function truncateDiagnosticValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > CHROMIUM_DIAGNOSTICS_MAX_FIELD_LENGTH
      ? `${value.slice(0, CHROMIUM_DIAGNOSTICS_MAX_FIELD_LENGTH)}... [truncated]`
      : value;
  }

  if (Array.isArray(value)) {
    return value.map(truncateDiagnosticValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        truncateDiagnosticValue(entryValue),
      ]),
    );
  }

  return value;
}

async function rotateChromiumDiagnosticsLogIfNeeded(logPath: string) {
  try {
    const stat = await fs.stat(logPath);
    if (stat.size < CHROMIUM_DIAGNOSTICS_MAX_BYTES) return;

    const rotatedPath = `${logPath}.1`;
    await fs.remove(rotatedPath);
    await fs.rename(logPath, rotatedPath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn("[chromium-diagnostics] Could not rotate log file", err);
    }
  }
}

function rotateChromiumDiagnosticsLogIfNeededSync(logPath: string) {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < CHROMIUM_DIAGNOSTICS_MAX_BYTES) return;

    const rotatedPath = `${logPath}.1`;
    fs.removeSync(rotatedPath);
    fs.renameSync(logPath, rotatedPath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn("[chromium-diagnostics] Could not rotate log file", err);
    }
  }
}

function takeChromiumDiagnosticsQueue() {
  const lines = chromiumDiagnosticsQueue.splice(0);
  if (chromiumDiagnosticsDropped > 0) {
    lines.unshift(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "diagnostics.queue-dropped",
        dropped: chromiumDiagnosticsDropped,
      }),
    );
    chromiumDiagnosticsDropped = 0;
  }
  return lines;
}

async function flushChromiumDiagnostics() {
  if (
    chromiumDiagnosticsFlushInProgress ||
    chromiumDiagnosticsQueue.length === 0
  ) {
    return;
  }

  chromiumDiagnosticsFlushInProgress = true;
  const lines = takeChromiumDiagnosticsQueue();

  try {
    const logPath = getChromiumDiagnosticsLogPath();
    await fs.ensureDir(path.dirname(logPath));
    await rotateChromiumDiagnosticsLogIfNeeded(logPath);
    const payload = `${lines.join("\n")}\n`;
    await fs.appendFile(logPath, payload, "utf-8");
    console.warn(
      `[chromium-diagnostics] flushed ${lines.length} event(s) to ${logPath}`,
    );
  } catch (err) {
    console.warn("[chromium-diagnostics] Could not write diagnostics log", err);
  } finally {
    chromiumDiagnosticsFlushInProgress = false;
    if (chromiumDiagnosticsQueue.length > 0) {
      scheduleChromiumDiagnosticsFlush();
    }
  }
}

function flushChromiumDiagnosticsSync() {
  if (
    chromiumDiagnosticsQueue.length === 0 &&
    chromiumDiagnosticsDropped === 0
  ) {
    return;
  }

  const lines = takeChromiumDiagnosticsQueue();

  try {
    const logPath = getChromiumDiagnosticsLogPath();
    fs.ensureDirSync(path.dirname(logPath));
    rotateChromiumDiagnosticsLogIfNeededSync(logPath);
    fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");
    console.warn(
      `[chromium-diagnostics] flushed ${lines.length} event(s) to ${logPath}`,
    );
  } catch (err) {
    console.warn("[chromium-diagnostics] Could not write diagnostics log", err);
  }
}

function scheduleChromiumDiagnosticsFlush() {
  if (chromiumDiagnosticsFlushTimer) return;

  chromiumDiagnosticsFlushTimer = setTimeout(() => {
    chromiumDiagnosticsFlushTimer = null;
    void flushChromiumDiagnostics();
  }, CHROMIUM_DIAGNOSTICS_FLUSH_MS);
  chromiumDiagnosticsFlushTimer.unref?.();
}

function logChromiumDiagnostic(
  eventName: string,
  details: Record<string, unknown> = {},
) {
  if (!isChromiumDiagnosticsEnabled()) return;

  const entry = {
    timestamp: new Date().toISOString(),
    event: eventName,
    ...details,
  };
  const line = JSON.stringify(truncateDiagnosticValue(entry));
  if (chromiumDiagnosticsQueue.length >= CHROMIUM_DIAGNOSTICS_MAX_QUEUE) {
    chromiumDiagnosticsQueue.shift();
    chromiumDiagnosticsDropped += 1;
  }
  chromiumDiagnosticsQueue.push(line);
  scheduleChromiumDiagnosticsFlush();
}

function queueChromiumDiagnosticLine(line: string) {
  if (!isChromiumDiagnosticsEnabled()) return;

  if (chromiumDiagnosticsQueue.length >= CHROMIUM_DIAGNOSTICS_MAX_QUEUE) {
    chromiumDiagnosticsQueue.shift();
    chromiumDiagnosticsDropped += 1;
  }
  chromiumDiagnosticsQueue.push(line);
  scheduleChromiumDiagnosticsFlush();
}

function getHardwareAccelerationDisabledSetting() {
  try {
    return getAppConfig().disableHardwareAcceleration ?? false;
  } catch {
    return false;
  }
}

function logChromiumDiagnosticsSessionStart(win?: BrowserWindow | null) {
  if (!isChromiumDiagnosticsEnabled()) return;

  const initialUrl =
    getWindowDiagnosticDetails(win).url ||
    MAIN_WINDOW_VITE_DEV_SERVER_URL ||
    "pending";
  const sessionLines = [
    "",
    "=== VE Foundry Client diagnostic session started ===",
    `Timestamp: ${new Date().toISOString()}`,
    `App version: ${app.getVersion()}`,
    `Electron version: ${process.versions.electron ?? "unknown"}`,
    `Chrome version: ${process.versions.chrome ?? "unknown"}`,
    `Node version: ${process.versions.node}`,
    `OS: ${process.platform} ${os.release()} ${os.arch()}`,
    `Hardware acceleration disabled: ${getHardwareAccelerationDisabledSetting()}`,
    `Chromium diagnostics enabled: ${isChromiumDiagnosticsEnabled()}`,
    `Initial URL: ${initialUrl}`,
    "",
  ];

  for (const line of sessionLines) {
    queueChromiumDiagnosticLine(line);
  }
  flushChromiumDiagnosticsSync();
}

function installAppProcessDiagnostics() {
  const flushOnShutdown = () => {
    if (chromiumDiagnosticsFlushTimer) {
      clearTimeout(chromiumDiagnosticsFlushTimer);
      chromiumDiagnosticsFlushTimer = null;
    }
    flushChromiumDiagnosticsSync();
  };

  app.on("before-quit", flushOnShutdown);
  app.on("will-quit", flushOnShutdown);

  app.on("render-process-gone", (_event, webContents, details) => {
    const win = BrowserWindow.fromWebContents(webContents);
    logChromiumDiagnostic("app.render-process-gone", {
      ...getWindowDiagnosticDetails(win),
      processType: "renderer",
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  app.on("child-process-gone", (_event, details) => {
    logChromiumDiagnostic("app.child-process-gone", {
      processType: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
  });
}

function normalizeConsoleMessage(args: any[]) {
  const details = args[0];
  if (details && typeof details === "object" && "message" in details) {
    return {
      level: details.level,
      message: details.message,
      sourceId: details.sourceId,
      line: details.lineNumber,
    };
  }

  return {
    level: args[0],
    message: args[1],
    line: args[2],
    sourceId: args[3],
  };
}

function attachWindowDiagnostics(win: BrowserWindow, identifier: string) {
  const withWindow = () => ({
    identifier,
    ...getWindowDiagnosticDetails(win),
  });

  win.on("unresponsive", () => {
    logChromiumDiagnostic("window.unresponsive", withWindow());
  });

  win.on("responsive", () => {
    logChromiumDiagnostic("window.responsive", withWindow());
  });

  win.webContents.on("console-message", (_event, ...args: any[]) => {
    logChromiumDiagnostic("webContents.console-message", {
      ...withWindow(),
      ...normalizeConsoleMessage(args),
    });
  });

  win.webContents.on("did-navigate", (_event, url, httpResponseCode) => {
    logChromiumDiagnostic("webContents.did-navigate", {
      ...withWindow(),
      url,
      httpResponseCode,
    });
  });

  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    logChromiumDiagnostic("webContents.did-navigate-in-page", {
      ...withWindow(),
      url,
      isMainFrame,
    });
  });

  win.webContents.on(
    "did-fail-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    ) => {
      logChromiumDiagnostic("webContents.did-fail-load", {
        ...withWindow(),
        errorCode,
        errorDescription,
        url: validatedURL || win.webContents.getURL(),
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      });
    },
  );

  win.webContents.on(
    "did-fail-provisional-load",
    (
      _event,
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
      frameProcessId,
      frameRoutingId,
    ) => {
      logChromiumDiagnostic("webContents.did-fail-provisional-load", {
        ...withWindow(),
        errorCode,
        errorDescription,
        url: validatedURL || win.webContents.getURL(),
        isMainFrame,
        frameProcessId,
        frameRoutingId,
      });
    },
  );

  win.webContents.on("render-process-gone", (_event, details) => {
    logChromiumDiagnostic("webContents.render-process-gone", {
      ...withWindow(),
      processType: "renderer",
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    logChromiumDiagnostic("webContents.preload-error", {
      ...withWindow(),
      preloadPath,
      reason: error?.message,
      stack: error?.stack,
    });
  });
}

installAppProcessDiagnostics();

app.whenReady().then(async () => {
  if (require("electron-squirrel-startup")) return;

  registerLocalAssetProtocol();

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
      {
        label: "Show Favorites",
        accelerator: "Ctrl+Shift+F",
        click: () => {
          showFavoritesPopup(getFocusedClientWindow());
        },
      },
      {
        label: "Server Select",
        accelerator: "Ctrl+Shift+S",
        click: () => {
          returnToServerSelect(getFocusedClientWindow());
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
  logChromiumDiagnosticsSessionStart(mainWindow);

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
    if (isDev) {
      initialCheckInProgress = false;
    } else {
      // only check once, right after launch
      autoUpdater
        .checkForUpdates()
        .then(async (result) => {
          if (!result?.updateInfo) return;
          // result has a .updateInfo object
          const latest = result.updateInfo?.version;
          const current = app.getVersion();

          if (latest && latest !== current) {
            const updateInfo = await enrichUpdateInfoWithReleaseNotes(
              result.updateInfo,
            );
            sendUpdateStatus(
              "available",
              { ...updateInfo, silent: true },
              mainWindow,
            );
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
    }

    if (migrationResult === "success") {
      notifyMainWindow(`Your user data has been successfully migrated`);
      console.log("Migration successful");
    } else if (migrationResult === "failure") {
      await askPrompt("Could not migrate your user data.", { mode: "alert" });
    }
    const importedOriginalUserData =
      await promptImportOriginalUserData(mainWindow);
    if (importedOriginalUserData) return;

    // Welcome, new users!
    if (isFirstUser) {
      notifyMainWindow(`Welcome!`);
    }
  });
});

ipcMain.handle("show-menu", () => {
  showApplicationMenu();
});

ipcMain.on("enable-discord-rpc", (event) => {
  startRichPresenceSocket();
  enableRichPresence(event.sender.id);
});

ipcMain.on("open-game", (e, gId, gameName: string, autoLogin = true) => {
  windowsData[e.sender.id].gameId = gId;
  windowsData[e.sender.id].autoLogin = autoLogin;
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
ipcMain.on(
  "save-login-records",
  (_e, records: Record<string, ImportedLoginRecord>) => {
    const currentData = getUserData();
    for (const [key, record] of Object.entries(records)) {
      const loginResult = GameUserDataSchema.safeParse(record);
      if (loginResult.success) {
        currentData[key] = loginResult.data;
      }
    }
    fs.writeFileSync(getUserDataPath(), JSON.stringify(currentData, null, 2));
  },
);
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

ipcMain.handle("dialog:choose-favorite-file", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select a file",
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  return { path: filePath, name: path.parse(filePath).name };
});

ipcMain.handle("dialog:choose-favorite-icon", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Select an icon or image",
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "ico"],
      },
    ],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
  const imagePath = filePaths[0];
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) return null;
  const iconsDir = path.join(app.getPath("userData"), "favorite-icons");
  fs.ensureDirSync(iconsDir);
  const fileName = `${Date.now()}-${crypto.randomUUID()}.png`;
  const outputPath = path.join(iconsDir, fileName);
  fs.writeFileSync(
    outputPath,
    image.resize({ width: 128, height: 128, quality: "best" }).toPNG(),
  );
  return {
    fileName,
    localUrl: pathToFileURL(outputPath).toString(),
    name: path.parse(imagePath).name,
  };
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

ipcMain.handle("local-file-icon", async (_event, filePath: string) => {
  try {
    const icon = await app.getFileIcon(filePath, { size: "normal" });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch (err) {
    console.error("local-file-icon failed:", err);
    return null;
  }
});

ipcMain.handle("remote-image-exists", async (_event, rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
});

ipcMain.handle("local-path-exists", async (_event, filePath: string) => {
  try {
    return fs.pathExists(filePath);
  } catch {
    return false;
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
  if (isDev) {
    sendUpdateStatus(
      "not-available",
      {
        version: app.getVersion(),
        releaseNotes: "Update checks are disabled while running locally.",
      },
      win,
    );
    return;
  }
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

ipcMain.handle("save-app-config", (_e, data: AppConfig) => {
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
  const openExternalLinksInBrowser =
    getAppConfig().externalLinksInDefaultBrowser ?? true;
  if (openExternalLinksInBrowser) {
    openUrlInDefaultBrowser(url);
    return;
  }

  openUrlInAppWindow(url, BrowserWindow.getFocusedWindow());
});

ipcMain.on("open-default-browser", (_event, url: string) => {
  openUrlInDefaultBrowser(url);
});

ipcMain.on("open-local-path", (_event, filePath: string) => {
  shell.openPath(filePath).catch((err) => {
    console.error("Failed to open local path", filePath, err);
  });
});

ipcMain.on("show-favorites-popup", (event) => {
  showFavoritesPopup(BrowserWindow.fromWebContents(event.sender));
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

function getServerBackgroundLocalUrl(fileName: string) {
  return `ve-local://server-backgrounds/${encodeURIComponent(path.basename(fileName))}`;
}

function getLocalPathFromServerBackgroundUrl(localUrl?: string) {
  if (!localUrl) return null;
  try {
    if (localUrl.startsWith("file://")) {
      return fileURLToPath(localUrl);
    }

    const parsedUrl = new URL(localUrl);
    if (parsedUrl.protocol !== "ve-local:") return null;
    if (parsedUrl.hostname !== "server-backgrounds") return null;

    const safeFileName = path.basename(decodeURIComponent(parsedUrl.pathname));
    return path.join(getServerBackgroundsDir(), safeFileName);
  } catch {
    return null;
  }
}

function getServerBackgroundsDir() {
  return path.join(app.getPath("userData"), "server-backgrounds");
}

function registerLocalAssetProtocol() {
  protocol.handle("ve-local", async (request) => {
    try {
      const parsedUrl = new URL(request.url);
      if (parsedUrl.hostname !== "server-backgrounds") {
        return new Response("Not found", { status: 404 });
      }

      const safeFileName = path.basename(
        decodeURIComponent(parsedUrl.pathname),
      );
      const filePath = path.join(getServerBackgroundsDir(), safeFileName);
      const backgroundsDir = path.resolve(getServerBackgroundsDir());
      const resolvedFilePath = path.resolve(filePath);

      if (
        path.dirname(resolvedFilePath) !== backgroundsDir ||
        !fs.pathExistsSync(resolvedFilePath)
      ) {
        return new Response("Not found", { status: 404 });
      }

      return net.fetch(pathToFileURL(resolvedFilePath).toString());
    } catch (err) {
      log.warn("[server-background] Failed to serve local asset", err);
      return new Response("Not found", { status: 404 });
    }
  });
}

function removeLocalServerBackground(fileUrl?: string) {
  const filePath = getLocalPathFromServerBackgroundUrl(fileUrl);
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
    localUrl: getServerBackgroundLocalUrl(filename),
  };
}

ipcMain.handle("server-background-local-url", (_e, fileName: string) => {
  const safeFileName = path.basename(fileName);
  const filePath = path.join(getServerBackgroundsDir(), safeFileName);
  if (!fs.pathExistsSync(filePath)) return null;
  return getServerBackgroundLocalUrl(safeFileName);
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
      const cachedLocalPath = getLocalPathFromServerBackgroundUrl(
        options.currentLocalUrl,
      );
      if (
        cachedRemoteUrl &&
        cachedRemoteUrl === options.currentRemoteUrl &&
        options.currentLocalUrl &&
        cachedLocalPath &&
        fs.pathExistsSync(cachedLocalPath) &&
        !options.force
      ) {
        const fileName = path.basename(cachedLocalPath);
        return {
          remoteUrl: cachedRemoteUrl,
          localUrl: getServerBackgroundLocalUrl(fileName),
          fileName,
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
          const currentLocalPath = getLocalPathFromServerBackgroundUrl(
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
            const fileName = path.basename(currentLocalPath);
            return {
              remoteUrl: backgroundUrl,
              localUrl: getServerBackgroundLocalUrl(fileName),
              fileName,
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
  const decrypt = (encrypted: Uint8Array, field: string) => {
    if (encrypted.length === 0 || !safeStorage.isEncryptionAvailable()) {
      return "";
    }

    try {
      return safeStorage.decryptString(Buffer.from(encrypted));
    } catch (err) {
      console.warn(
        `[userData] Could not decrypt ${field} for server ${String(gameId)}:`,
        err,
      );
      return "";
    }
  };

  return {
    user: userData.user,
    password: decrypt(password, "password"),
    adminPassword: decrypt(adminPassword, "admin password"),
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
