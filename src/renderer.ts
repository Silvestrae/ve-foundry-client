// noinspection JSIgnoredPromiseFromCall
import * as particles from "./utils/particles";
import {
  ThemeConfigSchema,
  ParticleOptions,
  GameConfig,
  FavoriteConfig,
  GameId,
} from "./schemas";
import { mergeAppData, mergeThemeData } from "./utils/mergeData";
import { showNotification, initNotificationTimer } from "./utils/notifications";
import {
  applyRuntimeAppConfig,
  setupPingInterval,
} from "./utils/appConfigHelpers";
import {
  updateServerInfos,
  refreshAllServerInfos,
} from "./utils/serverInfoHelpers";
import { getContrastColor } from "./utils/getContrastColor";
import { safePrompt } from "./utils/safePrompt";
import { hexToRgba } from "./utils/hexToRgba";
import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import { useUpdaterStore, UpdaterStatus } from "./stores/updater";
import { useUiStore } from "./stores/ui";
import App from "./App.vue";

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(ElementPlus);
app.mount("#app");

const updater = useUpdaterStore();
const ui = useUiStore();
window.api.onUpdaterStatus((_e, { status, payload }) => {
  updater.handleStatus({ status: status as UpdaterStatus, payload });
});

let preventMenuClose = false;
let lastParticleOptions: ParticleOptions | null = null;
let games: GameConfig[] = [];
let favorites: FavoriteConfig[] = [];
let editingFavoriteId: GameId | null = null;
let selectedFavoriteIconOverrideUrl = "";
let draggedGameItem: HTMLElement | null = null;
let draggedFavoriteItem: HTMLElement | null = null;
let mainEditModeEnabled = false;
let editingServerId: GameId | null = null;
let editingServerAutorunItems: FavoriteConfig[] = [];

const mainEditModeToggle = document.querySelector(
  "#toggle-main-edit-mode",
) as HTMLButtonElement;

function toCssUrl(url: string) {
  return `url("${url.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}

function setParticlesControlsEnabled(enabled: boolean) {
  const particlesConfig =
    document.querySelector<HTMLElement>(".particles-config");
  if (!particlesConfig) return;

  particlesConfig.classList.toggle("is-disabled", !enabled);
  particlesConfig
    .querySelectorAll<HTMLInputElement>("input")
    .forEach((input) => {
      input.disabled = !enabled;
    });
}

function applyServerButtonBackground(item: HTMLElement, localUrl?: string) {
  item.classList.remove("has-server-background");
  item.style.removeProperty("--server-background-image");

  if (!localUrl) return;
  item.style.setProperty("--server-background-image", toCssUrl(localUrl));
  item.classList.add("has-server-background");
}

async function applyCachedServerButtonBackground(
  item: HTMLElement,
  game: GameConfig,
) {
  if (game.backgroundImageFileName) {
    const localUrl = await window.api.serverBackgroundLocalUrl(
      game.backgroundImageFileName,
    );
    if (localUrl) {
      game.backgroundImageLocalUrl = localUrl;
      applyServerButtonBackground(item, localUrl);
      return;
    }
  }

  applyServerButtonBackground(item, game.backgroundImageLocalUrl);
}

async function refreshServerButtonBackground(
  item: HTMLElement,
  game: GameConfig,
  options: { force?: boolean } = {},
) {
  if (!game.url) return;

  try {
    const background = await window.api.serverBackground(game.url, {
      gameId: game.id ?? game.name,
      currentRemoteUrl: game.backgroundImageUrl,
      currentLocalUrl: game.backgroundImageLocalUrl,
      force: options.force,
    });
    if (!background) return;

    if (background.cleared) {
      game.backgroundImageUrl = undefined;
      game.backgroundImageLocalUrl = undefined;
      game.backgroundImageFileName = undefined;
      game.backgroundImageUpdatedAt = new Date().toISOString();
      applyServerButtonBackground(item);

      await updateGameList((appConfig) => {
        const gameToUpdate = appConfig.games.find((g) => g.id === game.id);
        if (gameToUpdate) {
          delete gameToUpdate.backgroundImageUrl;
          delete gameToUpdate.backgroundImageLocalUrl;
          delete gameToUpdate.backgroundImageFileName;
          gameToUpdate.backgroundImageUpdatedAt = game.backgroundImageUpdatedAt;
        }
      });
      return;
    }

    const shouldPersist =
      background.updated ||
      game.backgroundImageUrl !== background.remoteUrl ||
      game.backgroundImageLocalUrl !== background.localUrl ||
      game.backgroundImageFileName !== background.fileName;

    game.backgroundImageUrl = background.remoteUrl;
    game.backgroundImageLocalUrl = background.localUrl;
    game.backgroundImageFileName = background.fileName;
    if (shouldPersist) {
      game.backgroundImageUpdatedAt = new Date().toISOString();
    }
    applyServerButtonBackground(item, background.localUrl);

    if (!shouldPersist) return;

    await updateGameList((appConfig) => {
      const gameToUpdate = appConfig.games.find((g) => g.id === game.id);
      if (gameToUpdate) {
        gameToUpdate.backgroundImageUrl = background.remoteUrl;
        gameToUpdate.backgroundImageLocalUrl = background.localUrl;
        gameToUpdate.backgroundImageFileName = background.fileName;
        gameToUpdate.backgroundImageUpdatedAt = game.backgroundImageUpdatedAt;
      }
    });
  } catch (err) {
    console.warn(`Failed to load server background for ${game.name}:`, err);
  }
}

async function refreshAllServerButtonBackgrounds(
  options: { force?: boolean } = {},
) {
  await createGameList();
  const gameItems = Array.from(
    gameItemList.querySelectorAll<HTMLElement>(".game-item"),
  );

  for (const item of gameItems) {
    const gameId = item.dataset.gameId;
    const game = games.find((g) => getGameKey(g) === gameId);
    if (game) {
      await refreshServerButtonBackground(item, game, options);
    }
  }
}

/**
 * Dynamically inject or remove a Google Font from a <link> in <head>.
 * key is here to differentiate <link> (ex. "primary" or "secondary").
 */
function useGoogleFont(url: string, key: string) {
  const existing = document.getElementById(`gf-${key}`);
  if (existing) existing.remove();
  if (!url) return;
  const link = document.createElement("link");
  link.id = `gf-${key}`;
  link.rel = "stylesheet";
  link.href = url;
  document.head.append(link);
}

/**
 * Extracts family name from a Google Fonts URL.
 * Ex: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700" → "Roboto"
 */
function extractFamilyName(url: string): string {
  try {
    const params = new URL(url).searchParams.get("family");
    return params?.split(":")[0].replace(/_/g, " ") ?? "";
  } catch {
    return "";
  }
}

async function updateGameList(task: (appConfig: AppConfig) => void) {
  const appConfig = await window.api.localAppConfig();
  task(appConfig);
  games = appConfig.games ?? [];
  await window.api.saveAppConfig(appConfig);
}

async function updateFavoriteList(task: (appConfig: AppConfig) => void) {
  const appConfig = await window.api.localAppConfig();
  appConfig.favorites = appConfig.favorites ?? [];
  task(appConfig);
  favorites = appConfig.favorites ?? [];
  await window.api.saveAppConfig(appConfig);
}

window.api.showNotification((message: string) => {
  showNotification(message);
});

window.api.onShowPrompt(({ id, message, options }) => {
  safePrompt(message, options).then((answer) => {
    window.api.sendPromptResponse(id, answer);
  });
});

window.api.onRefreshServerBackgrounds(async () => {
  showNotification("Refreshing imported server backgrounds...");
  await refreshAllServerButtonBackgrounds({ force: true });
  showNotification("Server backgrounds refreshed");
});

window.api.onFullScreenChange((isFs) => {
  const closeButton = document.querySelector(
    ".tooltip-wrapper.close-app",
  ) as HTMLElement;
  closeButton.style.display = isFs ? "block" : "none";
});

document.querySelector("#add-game").addEventListener("click", async () => {
  const gameUrlField = document.querySelector("#game-url") as HTMLInputElement;
  const gameNameField = document.querySelector(
    "#game-name",
  ) as HTMLInputElement;
  const gameUrl = gameUrlField.value;
  const gameName = gameNameField.value;
  if (!gameUrl || !gameName) {
    await safePrompt("Please enter a game name and URL.", { mode: "alert" });
    return;
  }
  const newGameItem = {
    name: gameName,
    url: gameUrl,
    id: Math.round(Math.random() * 1000000),
    autoLoginEnabled: true,
  } as GameConfig;
  await updateGameList((appConfig) => {
    appConfig.games = appConfig?.games ?? [];
    appConfig.games.push(newGameItem);
  });
  gameUrlField.value = "";
  gameNameField.value = "";
  const gameItem = await createGameItem(newGameItem);
  await refreshServerButtonBackground(gameItem, newGameItem, { force: true });
  showNotification("Game added");
});

const gameItemList = document.querySelector("#game-list");
const serverColumnButtons = document.querySelectorAll<HTMLButtonElement>(
  ".server-column-option",
);
const favoriteColumnButtons = document.querySelectorAll<HTMLButtonElement>(
  ".favorite-column-option",
);
const gameItemTemplate = document
  .querySelector("template")
  .content.querySelector("li");
const favoriteList = document.querySelector("#favorite-list") as HTMLElement;
const favoriteNameField = document.querySelector(
  "#favorite-name",
) as HTMLInputElement;
const favoriteUrlField = document.querySelector(
  "#favorite-url",
) as HTMLInputElement;
const chooseFavoriteFileButton = document.querySelector(
  "#choose-favorite-file",
) as HTMLButtonElement;
const chooseFavoriteIconButton = document.querySelector(
  "#choose-favorite-icon",
) as HTMLButtonElement;
const addFavoriteButton = document.querySelector(
  "#add-favorite",
) as HTMLButtonElement;
const cancelFavoriteEditButton = document.querySelector(
  "#cancel-favorite-edit",
) as HTMLButtonElement;
const favoriteEmptyState = document.querySelector(
  "#favorite-empty-state",
) as HTMLElement;
const favoriteSectionTitle = document.querySelector(
  "#favorites-section .section-title",
) as HTMLElement;
const favoriteShortcutHint = document.querySelector(
  "#favorite-shortcut-hint",
) as HTMLElement;
const serverSettingsModal = document.querySelector(
  "#server-settings-modal",
) as HTMLElement;
const closeServerSettingsButton = document.querySelector(
  "#close-server-settings",
) as HTMLButtonElement;
const saveServerSettingsButton = document.querySelector(
  "#save-server-settings",
) as HTMLButtonElement;
const deleteServerSettingsButton = document.querySelector(
  "#delete-server-settings",
) as HTMLButtonElement;
const serverSettingsNameField = document.querySelector(
  "#server-settings-name",
) as HTMLInputElement;
const serverSettingsUrlField = document.querySelector(
  "#server-settings-url",
) as HTMLInputElement;
const serverSettingsUserField = document.querySelector(
  "#server-settings-user",
) as HTMLInputElement;
const serverSettingsPasswordField = document.querySelector(
  "#server-settings-password",
) as HTMLInputElement;
const serverSettingsAdminPasswordField = document.querySelector(
  "#server-settings-admin-password",
) as HTMLInputElement;
const serverSettingsDisableRefreshField = document.querySelector(
  "#server-settings-disable-refresh",
) as HTMLInputElement;
const serverSettingsAutoLoginField = document.querySelector(
  "#server-settings-auto-login",
) as HTMLInputElement;
const serverAutorunList = document.querySelector(
  "#server-autorun-list",
) as HTMLElement;
const serverAutorunTitle = document.querySelector(
  "#server-autorun-title",
) as HTMLElement;
const serverAutorunNameField = document.querySelector(
  "#server-autorun-name",
) as HTMLInputElement;
const serverAutorunTargetField = document.querySelector(
  "#server-autorun-target",
) as HTMLInputElement;
const chooseServerAutorunFileButton = document.querySelector(
  "#choose-server-autorun-file",
) as HTMLButtonElement;
const addServerAutorunButton = document.querySelector(
  "#add-server-autorun",
) as HTMLButtonElement;

function closeServerSettings() {
  editingServerId = null;
  editingServerAutorunItems = [];
  serverSettingsModal.classList.add("hidden-display");
}

function renderServerAutorunList() {
  serverAutorunList.replaceChildren();

  if (editingServerAutorunItems.length === 0) {
    const empty = document.createElement("li");
    empty.className = "server-autorun-empty";
    empty.textContent = "Nothing will open automatically yet.";
    serverAutorunList.append(empty);
    return;
  }

  editingServerAutorunItems.forEach((item) => {
    const li = document.createElement("li");
    li.className = "server-autorun-item";

    const text = document.createElement("div");
    text.className = "server-autorun-text";

    const name = document.createElement("span");
    name.className = "server-autorun-name";
    name.textContent = item.name;

    const target = document.createElement("span");
    target.className = "server-autorun-target";
    target.textContent = getAutorunItemTargetText(item);

    const remove = document.createElement("button");
    remove.className = "server-autorun-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
    remove.addEventListener("click", () => {
      editingServerAutorunItems = editingServerAutorunItems.filter(
        (storedItem) => String(storedItem.id) !== String(item.id),
      );
      renderServerAutorunList();
    });

    text.append(name, target);
    li.append(text, remove);
    serverAutorunList.append(li);
  });
}

function usesCommonwealthEnglish() {
  const commonwealthLocales = new Set([
    "au",
    "gb",
    "ie",
    "nz",
    "za",
    "ca",
    "in",
  ]);
  const locales = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];

  return locales.some((locale) => {
    const [, region] = locale.toLowerCase().split("-");
    return region ? commonwealthLocales.has(region) : false;
  });
}

const favoriteLabels = usesCommonwealthEnglish()
  ? { singular: "Favourite", plural: "Favourites" }
  : { singular: "Favorite", plural: "Favorites" };

favoriteSectionTitle.textContent = favoriteLabels.plural;
favoriteShortcutHint.textContent = `Press Ctrl+Alt+F in game to open ${favoriteLabels.plural.toLowerCase()}.`;
serverAutorunTitle.textContent = `Autorun ${favoriteLabels.plural}`;
favoriteEmptyState.textContent = `Add your first ${favoriteLabels.singular.toLowerCase()} website or file.`;

function getGameKey(game: GameConfig): string {
  return String(game.id ?? game.name);
}

function findGameByKey(gameId: GameId | string | null) {
  if (gameId === null) return undefined;
  return games.find((game) => getGameKey(game) === String(gameId));
}

function getFavoriteKey(favorite: FavoriteConfig): string {
  return String(favorite.id ?? favorite.name);
}

function getServerColumnCount(appConfig: AppConfig): 1 | 2 {
  return appConfig.serverColumnCount === 2 ? 2 : 1;
}

function getFavoriteColumnCount(appConfig: AppConfig): 2 | 3 | 4 {
  return appConfig.favoriteColumnCount === 2 ||
    appConfig.favoriteColumnCount === 4
    ? appConfig.favoriteColumnCount
    : 3;
}

function applyServerColumnCount(columnCount: 1 | 2) {
  gameItemList.classList.toggle("server-columns-2", columnCount === 2);
  gameItemList.classList.toggle("server-columns-1", columnCount === 1);
  gameItemList
    .closest(".servers-section")
    ?.classList.toggle("server-columns-active", columnCount === 2);
  serverColumnButtons.forEach((button) => {
    const isActive = button.dataset.serverColumns === String(columnCount);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function applyFavoriteColumnCount(columnCount: 2 | 3 | 4) {
  favoriteList.classList.toggle("favorite-columns-2", columnCount === 2);
  favoriteList.classList.toggle("favorite-columns-3", columnCount === 3);
  favoriteList.classList.toggle("favorite-columns-4", columnCount === 4);
  favoriteColumnButtons.forEach((button) => {
    const isActive = button.dataset.favoriteColumns === String(columnCount);
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function normalizeFavoriteUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return "";
  return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

function isLikelyLocalPath(value: string) {
  const trimmed = value.trim();
  return (
    /^[a-z]:[\\/]/i.test(trimmed) ||
    /^\\\\/.test(trimmed) ||
    /^\//.test(trimmed) ||
    /^~[\\/]/.test(trimmed)
  );
}

function isFileFavorite(favorite: FavoriteConfig) {
  return favorite.type === "file" || (!!favorite.filePath && !favorite.url);
}

function getFavoriteTarget(favorite: FavoriteConfig) {
  return isFileFavorite(favorite)
    ? (favorite.filePath ?? "")
    : (favorite.url ?? "");
}

function createFavoriteLikeItem(name: string, target: string): FavoriteConfig {
  const isFile = isLikelyLocalPath(target);
  const url = isFile ? "" : normalizeFavoriteUrl(target);
  return {
    id: Math.round(Math.random() * 1000000),
    name,
    type: isFile ? "file" : "website",
    url: isFile ? undefined : url,
    filePath: isFile ? target : undefined,
    iconUrl: isFile ? undefined : getFaviconUrl(url),
  };
}

function getAutorunItemTargetText(item: FavoriteConfig) {
  const target = getFavoriteTarget(item);
  return isFileFavorite(item) ? target || "Local file" : getUrlHost(target);
}

function openAutorunItems(items: FavoriteConfig[] = []) {
  items.forEach((item) => {
    const target = getFavoriteTarget(item);
    if (!target) return;

    if (isFileFavorite(item)) {
      window.api.openLocalPath(target);
      return;
    }

    window.api.openDefaultBrowser(target);
  });
}

function getUrlHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string) {
  if (!url || isLikelyLocalPath(url)) return "";
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(
      parsed.origin,
    )}&sz=64`;
  } catch {
    return "";
  }
}

function getWebsiteSnapshotUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `https://api.microlink.io/?url=${encodeURIComponent(
      parsed.href,
    )}&screenshot=true&embed=screenshot.url`;
  } catch {
    return "";
  }
}

function setFavoriteEditMode(favorite?: FavoriteConfig) {
  editingFavoriteId = favorite?.id ?? null;
  selectedFavoriteIconOverrideUrl = favorite?.iconOverrideUrl ?? "";
  favoriteNameField.value = favorite?.name ?? "";
  favoriteUrlField.value = getFavoriteTarget(
    favorite ?? ({} as FavoriteConfig),
  );
  addFavoriteButton.textContent = favorite
    ? `Save ${favoriteLabels.singular}`
    : `Add ${favoriteLabels.singular}`;
  chooseFavoriteIconButton.setAttribute(
    "aria-label",
    favorite?.iconOverrideUrl ? "Change icon" : "Choose icon",
  );
  chooseFavoriteIconButton.title = favorite?.iconOverrideUrl
    ? "Change icon"
    : "Choose icon";
  cancelFavoriteEditButton.classList.toggle("hidden-display", !favorite);
}

chooseFavoriteFileButton.addEventListener("click", async () => {
  const file = await window.api.chooseFavoriteFile();
  if (!file) return;
  favoriteUrlField.value = file.path;
  if (!favoriteNameField.value.trim()) {
    favoriteNameField.value = file.name;
  }
});

chooseServerAutorunFileButton.addEventListener("click", async () => {
  const file = await window.api.chooseFavoriteFile();
  if (!file) return;
  serverAutorunTargetField.value = file.path;
  if (!serverAutorunNameField.value.trim()) {
    serverAutorunNameField.value = file.name;
  }
});

addServerAutorunButton.addEventListener("click", async () => {
  const name = serverAutorunNameField.value.trim();
  const target = serverAutorunTargetField.value.trim();

  if (!name || !target) {
    await safePrompt("Please enter an autorun name and URL or file path.", {
      mode: "alert",
    });
    return;
  }

  if (!isLikelyLocalPath(target)) {
    try {
      new URL(normalizeFavoriteUrl(target));
    } catch {
      await safePrompt("Please enter a valid autorun URL.", { mode: "alert" });
      return;
    }
  }

  editingServerAutorunItems.push(createFavoriteLikeItem(name, target));
  serverAutorunNameField.value = "";
  serverAutorunTargetField.value = "";
  renderServerAutorunList();
});

chooseFavoriteIconButton.addEventListener("click", async () => {
  const image = await window.api.chooseFavoriteIcon();
  if (!image) return;
  selectedFavoriteIconOverrideUrl = image.localUrl;
  chooseFavoriteIconButton.setAttribute("aria-label", "Change icon");
  chooseFavoriteIconButton.title = "Change icon";
  if (!favoriteNameField.value.trim()) {
    favoriteNameField.value = image.name;
  }
});

addFavoriteButton.addEventListener("click", async () => {
  const favoriteName = favoriteNameField.value.trim();
  const favoriteTarget = favoriteUrlField.value.trim();
  const isFile = isLikelyLocalPath(favoriteTarget);
  const favoriteUrl = isFile ? "" : normalizeFavoriteUrl(favoriteTarget);
  const filePath = isFile ? favoriteTarget : "";
  if (!favoriteName || (!favoriteUrl && !filePath)) {
    await safePrompt(
      `Please enter a ${favoriteLabels.singular} name and website URL or file path.`,
      {
        mode: "alert",
      },
    );
    return;
  }

  if (!isFile) {
    try {
      new URL(favoriteUrl);
    } catch {
      await safePrompt("Please enter a valid website URL.", { mode: "alert" });
      return;
    }
  }

  if (editingFavoriteId !== null) {
    await updateFavoriteList((appConfig) => {
      const favorite = appConfig.favorites?.find(
        (item) => String(item.id) === String(editingFavoriteId),
      );
      if (favorite) {
        favorite.name = favoriteName;
        favorite.type = isFile ? "file" : "website";
        favorite.url = isFile ? undefined : favoriteUrl;
        favorite.filePath = isFile ? filePath : undefined;
        favorite.iconUrl = isFile ? undefined : getFaviconUrl(favoriteUrl);
        favorite.iconOverrideUrl = selectedFavoriteIconOverrideUrl || undefined;
      }
    });
    showNotification(`${favoriteLabels.singular} saved`);
  } else {
    const newFavorite: FavoriteConfig = {
      id: Math.round(Math.random() * 1000000),
      name: favoriteName,
      type: isFile ? "file" : "website",
      url: isFile ? undefined : favoriteUrl,
      filePath: isFile ? filePath : undefined,
      iconUrl: isFile ? undefined : getFaviconUrl(favoriteUrl),
      iconOverrideUrl: selectedFavoriteIconOverrideUrl || undefined,
    };
    await updateFavoriteList((appConfig) => {
      appConfig.favorites = appConfig.favorites ?? [];
      appConfig.favorites.push(newFavorite);
    });
    showNotification(`${favoriteLabels.singular} added`);
  }

  setFavoriteEditMode();
  await createFavoriteList();
});

cancelFavoriteEditButton.addEventListener("click", () => {
  setFavoriteEditMode();
});

serverColumnButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const columnCount = button.dataset.serverColumns === "2" ? 2 : 1;
    await updateGameList((appConfig) => {
      appConfig.serverColumnCount = columnCount;
    });
    applyServerColumnCount(columnCount);
  });
});

favoriteColumnButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const columnCount =
      button.dataset.favoriteColumns === "2"
        ? 2
        : button.dataset.favoriteColumns === "4"
          ? 4
          : 3;
    await updateFavoriteList((appConfig) => {
      appConfig.favoriteColumnCount = columnCount;
    });
    applyFavoriteColumnCount(columnCount);
  });
});

function getDragAfterElement(y: number): HTMLElement | null {
  const items = Array.from(
    gameItemList.querySelectorAll<HTMLElement>(".game-item:not(.dragging)"),
  );

  return items.reduce<{ offset: number; element: HTMLElement | null }>(
    (closest, item) => {
      const box = item.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset, element: item };
      }

      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null },
  ).element;
}

async function saveGameOrder() {
  const orderedKeys = Array.from(
    gameItemList.querySelectorAll<HTMLElement>(".game-item"),
  ).map((item) => item.dataset.gameId);

  await updateGameList((appConfig) => {
    const byKey = new Map(
      (appConfig.games ?? []).map((game) => [getGameKey(game), game]),
    );
    const orderedGames = orderedKeys
      .map((key) => (key ? byKey.get(key) : undefined))
      .filter((game): game is GameConfig => !!game);

    const orderedKeySet = new Set(orderedKeys);
    const missingGames = (appConfig.games ?? []).filter(
      (game) => !orderedKeySet.has(getGameKey(game)),
    );

    appConfig.games = [...orderedGames, ...missingGames];
  });
}

function setupServerReorder(li: HTMLElement) {
  const handle = li.querySelector<HTMLElement>(".reorder-game");
  if (!handle) return;

  handle.addEventListener("dragstart", (event) => {
    if (!mainEditModeEnabled) {
      event.preventDefault();
      return;
    }
    draggedGameItem = li;
    li.classList.add("dragging");
    event.dataTransfer?.setData("text/plain", li.dataset.gameId ?? "");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  });

  handle.addEventListener("dragend", async () => {
    li.classList.remove("dragging");
    draggedGameItem = null;
    await saveGameOrder();
    showNotification("Server order saved");
  });
}

async function saveFavoriteOrder() {
  const orderedKeys = Array.from(
    favoriteList.querySelectorAll<HTMLElement>(".favorite-item"),
  ).map((item) => item.dataset.favoriteId);

  await updateFavoriteList((appConfig) => {
    const byKey = new Map(
      (appConfig.favorites ?? []).map((favorite) => [
        getFavoriteKey(favorite),
        favorite,
      ]),
    );
    const orderedFavorites = orderedKeys
      .map((key) => (key ? byKey.get(key) : undefined))
      .filter((favorite): favorite is FavoriteConfig => !!favorite);

    const orderedKeySet = new Set(orderedKeys);
    const missingFavorites = (appConfig.favorites ?? []).filter(
      (favorite) => !orderedKeySet.has(getFavoriteKey(favorite)),
    );

    appConfig.favorites = [...orderedFavorites, ...missingFavorites];
  });
}

function getFavoriteDragAfterElement(x: number, y: number): HTMLElement | null {
  const items = Array.from(
    favoriteList.querySelectorAll<HTMLElement>(".favorite-item:not(.dragging)"),
  );

  return items.reduce<{ distance: number; element: HTMLElement | null }>(
    (closest, item) => {
      const box = item.getBoundingClientRect();
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      const isBefore = dy < 0 || (Math.abs(dy) < box.height / 2 && dx < 0);
      const distance = Math.hypot(dx, dy);

      if (isBefore && distance < closest.distance) {
        return { distance, element: item };
      }

      return closest;
    },
    { distance: Number.POSITIVE_INFINITY, element: null },
  ).element;
}

function setupFavoriteReorder(li: HTMLElement) {
  li.addEventListener("dragstart", (event) => {
    if (!mainEditModeEnabled) {
      event.preventDefault();
      return;
    }
    draggedFavoriteItem = li;
    li.classList.add("dragging");
    event.dataTransfer?.setData("text/plain", li.dataset.favoriteId ?? "");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  });

  li.addEventListener("dragend", async () => {
    li.classList.remove("dragging");
    draggedFavoriteItem = null;
    await saveFavoriteOrder();
    showNotification(`${favoriteLabels.singular} order saved`);
  });
}

gameItemList.addEventListener("dragover", (event: DragEvent) => {
  if (!mainEditModeEnabled || !draggedGameItem) return;

  event.preventDefault();
  const afterElement = getDragAfterElement(event.clientY);
  if (afterElement) {
    gameItemList.insertBefore(draggedGameItem, afterElement);
  } else {
    gameItemList.appendChild(draggedGameItem);
  }
});

favoriteList.addEventListener("dragover", (event: DragEvent) => {
  if (!mainEditModeEnabled || !draggedFavoriteItem) return;

  event.preventDefault();
  const afterElement = getFavoriteDragAfterElement(
    event.clientX,
    event.clientY,
  );
  if (afterElement) {
    favoriteList.insertBefore(draggedFavoriteItem, afterElement);
  } else {
    favoriteList.appendChild(draggedFavoriteItem);
  }
});

function setMainEditMode(enabled: boolean) {
  mainEditModeEnabled = enabled;
  document.body.classList.toggle("main-edit-mode", enabled);
  mainEditModeToggle.setAttribute("aria-pressed", String(enabled));
  mainEditModeToggle.setAttribute(
    "aria-label",
    enabled ? "Switch to Play Mode" : "Switch to Edit Mode",
  );
  mainEditModeToggle.removeAttribute("title");
  mainEditModeToggle.innerHTML = enabled
    ? '<i class="fa-solid fa-pen-nib"></i>'
    : '<i class="fa-solid fa-lock"></i>';

  const tooltip = mainEditModeToggle
    .closest(".tooltip-wrapper")
    ?.querySelector(".tooltip");
  if (tooltip) {
    tooltip.textContent = enabled
      ? "Switch to Play Mode"
      : "Switch to Edit Mode";
  }

  document
    .querySelectorAll<HTMLElement>(".reorder-game, .favorite-item")
    .forEach((handle) => {
      handle.draggable = enabled;
    });

  if (!enabled) {
    setFavoriteEditMode();
    closeServerSettings();
  }

  renderTooltips();
}

mainEditModeToggle.addEventListener("click", () => {
  setMainEditMode(!mainEditModeEnabled);
});

document
  .querySelector("#save-theme-config")
  .addEventListener("click", async (e) => {
    if (!(e.target instanceof Element)) return;

    const themeConfigMenu = document.querySelector(
      ".theme-configuration",
    ) as HTMLDivElement;

    if (themeConfigMenu && !preventMenuClose) {
      themeConfigMenu.classList.add("hidden2");

      const computedStyle = window.getComputedStyle(themeConfigMenu);
      const transitionDuration =
        parseFloat(computedStyle.transitionDuration) || 0;

      if (transitionDuration > 0) {
        themeConfigMenu.addEventListener("transitionend", function handler(e) {
          if (e.propertyName === "opacity") {
            themeConfigMenu.classList.remove("show");
            themeConfigMenu.classList.remove("flex-display");
            themeConfigMenu.classList.add("hidden-display");
            themeConfigMenu.removeEventListener("transitionend", handler);
          }
        });
      } else {
        themeConfigMenu.classList.remove("show");
        themeConfigMenu.classList.remove("flex-display");
        themeConfigMenu.classList.add("hidden-display");
      }
    }

    preventMenuClose = false;
    const existingConfig = await window.api.localThemeConfig();
    const closeUserConfig = e.target.closest(
      ".theme-configuration",
    ) as HTMLDivElement;
    const background = (
      closeUserConfig.querySelector("#background-image") as HTMLInputElement
    ).value;
    const accentColor = (
      closeUserConfig.querySelector("#accent-color") as HTMLInputElement
    ).value;
    const backgroundColor = (
      closeUserConfig.querySelector("#background-color") as HTMLInputElement
    ).value;
    const textColor = (
      closeUserConfig.querySelector("#text-color") as HTMLInputElement
    ).value;
    const buttonColorAlphaInput = closeUserConfig.querySelector(
      "#button-color-alpha",
    ) as HTMLInputElement;
    const buttonColorAlpha = buttonColorAlphaInput.valueAsNumber;
    const buttonColor = (
      closeUserConfig.querySelector("#button-color") as HTMLInputElement
    ).value;
    const buttonColorHoverAlphaInput = closeUserConfig.querySelector(
      "#button-color-hover-alpha",
    ) as HTMLInputElement;
    const buttonColorHoverAlpha = buttonColorHoverAlphaInput.valueAsNumber;
    const buttonColorHover = (
      closeUserConfig.querySelector("#button-color-hover") as HTMLInputElement
    ).value;
    const particlesEnabled = (
      closeUserConfig.querySelector("#particles-button") as HTMLInputElement
    ).checked;
    const particlesCount = Number(
      (closeUserConfig.querySelector("#particles-count") as HTMLInputElement)
        .value,
    );
    const particlesSpeed = Number(
      (closeUserConfig.querySelector("#particles-speed") as HTMLInputElement)
        .value,
    );
    const particlesColorAlphaInput = closeUserConfig.querySelector(
      "#particles-color-alpha",
    ) as HTMLInputElement;
    const particlesColorAlpha = particlesColorAlphaInput.valueAsNumber;
    const particlesColor = (
      closeUserConfig.querySelector("#particles-color") as HTMLInputElement
    ).value;
    const primaryFontSelect = document.querySelector(
      "#primary-font-selector",
    ) as HTMLSelectElement;
    const secondaryFontSelect = document.querySelector(
      "#secondary-font-selector",
    ) as HTMLSelectElement;
    const customPrimary = document.querySelector<HTMLInputElement>(
      "#primary-custom-font",
    )!;
    const customSecondary = document.querySelector<HTMLInputElement>(
      "#secondary-custom-font",
    )!;
    const config = {
      baseTheme: "codex",
      accentColor,
      backgroundColor,
      background,
      textColor,
      buttonColorAlpha,
      buttonColor,
      buttonColorHoverAlpha,
      buttonColorHover,
      particlesEnabled,
      particleOptions: {
        count: particlesCount,
        speedYMin: particlesSpeed / 2,
        speedYMax: particlesSpeed,
        color: particlesColor,
        alpha: particlesColorAlpha,
      },
    } as ThemeConfig;

    if (primaryFontSelect.value === "__custom") {
      config.fontPrimaryUrl = customPrimary.value.trim();
      config.fontPrimary = "__custom";
    } else if (primaryFontSelect.value === "__file") {
      config.fontPrimary = "__file";
      config.fontPrimaryName = existingConfig.fontPrimaryName;
      config.fontPrimaryFilePath = existingConfig.fontPrimaryFilePath;
    } else {
      config.fontPrimary = primaryFontSelect.value;
      config.fontPrimaryUrl = "";
      config.fontPrimaryFilePath = "";
      config.fontPrimaryName = "";
    }

    if (secondaryFontSelect.value === "__custom") {
      config.fontSecondaryUrl = customSecondary.value.trim();
      config.fontSecondary = "__custom";
    } else if (secondaryFontSelect.value === "__file") {
      config.fontSecondary = "__file";
      config.fontSecondaryName = existingConfig.fontSecondaryName;
      config.fontSecondaryFilePath = existingConfig.fontSecondaryFilePath;
    } else {
      config.fontSecondary = secondaryFontSelect.value;
      config.fontSecondaryUrl = "";
      config.fontSecondaryFilePath = "";
      config.fontSecondaryName = "";
    }

    const rawConfig: unknown = { ...config };

    const result = ThemeConfigSchema.safeParse(rawConfig);
    if (!result.success) {
      console.error(result.error.format());
      await safePrompt(
        "Invalid theme values detected. Changes were not applied.",
        { mode: "alert" },
      );
      const themeConfig = await window.api.localThemeConfig();
      applyThemeConfig(themeConfig);
      return;
    }

    console.log(config);
    const validConfig = result.data as ThemeConfig;

    await window.api.saveThemeConfig(validConfig);
    applyThemeConfig(validConfig);
    showNotification("Theme saved");
  });

const cancelThemeButton = document.querySelector(
  "#cancel-theme-config",
) as HTMLButtonElement;

if (cancelThemeButton) {
  cancelThemeButton.addEventListener("click", async () => {
    const themeConfig = await window.api.localThemeConfig();
    applyThemeConfig(themeConfig);
    showNotification("Changes canceled");

    const themeConfigMenu = document.querySelector(
      ".theme-configuration",
    ) as HTMLDivElement;
    if (themeConfigMenu) {
      themeConfigMenu.classList.add("hidden2");

      const computedStyle = window.getComputedStyle(themeConfigMenu);
      const transitionDuration =
        parseFloat(computedStyle.transitionDuration) || 0;

      if (transitionDuration > 0) {
        themeConfigMenu.addEventListener("transitionend", function handler(e) {
          if (e.propertyName === "opacity") {
            themeConfigMenu.classList.remove("show");
            themeConfigMenu.classList.remove("flex-display");
            themeConfigMenu.classList.add("hidden-display");
            themeConfigMenu.removeEventListener("transitionend", handler);
          }
        });
      } else {
        themeConfigMenu.classList.remove("show");
        themeConfigMenu.classList.remove("flex-display");
        themeConfigMenu.classList.add("hidden-display");
      }
    }
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "F1" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    window.api.showMenu();
  }
});

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest(
    ".toggle-password",
  ) as HTMLButtonElement | null;
  if (!target) return;

  const input = target
    .closest(".password-field")
    ?.querySelector("input") as HTMLInputElement;
  if (!input) return;

  if (input.type === "password") {
    input.type = "text";
    target.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
  } else {
    input.type = "password";
    target.innerHTML = '<i class="fa-solid fa-eye"></i>';
  }
});

const closeButton = document.querySelector(".tooltip-wrapper.close-app")!;
closeButton.addEventListener("click", () => {
  window.api.closeWindow();
});

document.addEventListener("DOMContentLoaded", async () => {
  const themeStylesheet = document.getElementById(
    "theme-stylesheet",
  ) as HTMLLinkElement;
  const updaterStylesheet = document.getElementById(
    "updater-stylesheet",
  ) as HTMLLinkElement;
  const appConfigStylesheet = document.getElementById(
    "client-settings-stylesheet",
  ) as HTMLLinkElement;

  if (!themeStylesheet) {
    console.error("Theme stylesheet not found.");
    return;
  }

  await initNotificationTimer();
  const appConfig: AppConfig = await window.api.localAppConfig();
  const themeConfig: ThemeConfig = await window.api.localThemeConfig();

  const primaryFontSelect = document.querySelector<HTMLSelectElement>(
    "#primary-font-selector",
  )!;
  const primaryCustomField = document.getElementById("primary-custom-font")!;
  const primaryImportField = document.getElementById("primary-import-font")!;
  const setPrimaryFontAuxControls = () => {
    const customVisible = primaryFontSelect.value === "__custom";
    const importVisible = primaryFontSelect.value === "__file";
    primaryCustomField.style.display = customVisible ? "flex" : "none";
    primaryCustomField.parentElement!.style.display = customVisible
      ? "flex"
      : "none";
    primaryImportField.style.display = importVisible ? "block" : "none";
    primaryImportField.parentElement!.style.display = importVisible
      ? "flex"
      : "none";
  };
  if (themeConfig.fontPrimary === "__custom") {
    primaryFontSelect.value = "__custom";
  } else if (themeConfig.fontPrimary === "__file") {
    primaryFontSelect.value = "__file";
  }
  setPrimaryFontAuxControls();
  primaryFontSelect.addEventListener("change", setPrimaryFontAuxControls);

  const secondaryFontSelect = document.querySelector<HTMLSelectElement>(
    "#secondary-font-selector",
  )!;
  const secondaryCustomField = document.getElementById(
    "secondary-custom-font",
  )!;
  const secondaryImportField = document.getElementById(
    "secondary-import-font",
  )!;
  const setSecondaryFontAuxControls = () => {
    const customVisible = secondaryFontSelect.value === "__custom";
    const importVisible = secondaryFontSelect.value === "__file";
    secondaryCustomField.style.display = customVisible ? "flex" : "none";
    secondaryCustomField.parentElement!.style.display = customVisible
      ? "flex"
      : "none";
    secondaryImportField.style.display = importVisible ? "block" : "none";
    secondaryImportField.parentElement!.style.display = importVisible
      ? "flex"
      : "none";
  };

  if (themeConfig.fontSecondary === "__custom") {
    secondaryFontSelect.value = "__custom";
  } else if (themeConfig.fontSecondary === "__file") {
    secondaryFontSelect.value = "__file";
  }
  setSecondaryFontAuxControls();
  secondaryFontSelect.addEventListener("change", setSecondaryFontAuxControls);

  const loadPrimaryFontFileBtn = document.getElementById(
    "primary-import-font",
  )!;

  loadPrimaryFontFileBtn.addEventListener("click", async () => {
    const fontPath = await window.api.chooseFontFile();
    if (!fontPath) return;

    // Read the raw bytes, base64-encoded
    const b64 = await window.api.readFontFile(fontPath);
    if (!b64) {
      showNotification("Failed to load font file.");
      return;
    }

    // Derive a font name and MIME type
    const filename = fontPath.split(/[\\/]/).pop()!;
    const fontName = filename.replace(/\.[^.]+$/, "");
    const ext = filename.split(".").pop()!.toLowerCase();
    const mime =
      ext === "ttf"
        ? "font/ttf"
        : ext === "otf"
          ? "font/otf"
          : ext === "woff"
            ? "font/woff"
            : ext === "woff2"
              ? "font/woff2"
              : "application/octet-stream";

    // Build the data: URI
    const dataUri = `data:${mime};base64,${b64}`;

    // Inject @font-face
    const rule = `
        @font-face {
          font-family: "${fontName}";
          src: url("${dataUri}") format("${ext}");
          font-weight: normal;
          font-style: normal;
        }
      `;
    const style = document.createElement("style");
    style.textContent = rule;
    document.head.append(style);

    // Apply immediately
    document.documentElement.style.setProperty(
      "--font-primary",
      `"${fontName}", sans-serif`,
    );

    // Persist to config
    themeConfig.fontPrimary = "__file";
    themeConfig.fontPrimaryName = fontName;
    themeConfig.fontPrimaryFilePath = dataUri;

    await window.api.saveThemeConfig(themeConfig);

    showNotification("Primary font loaded successfully");
  });

  const loadSecondaryFontFileBtn = document.getElementById(
    "secondary-import-font",
  )!;

  loadSecondaryFontFileBtn.addEventListener("click", async () => {
    const fontPath = await window.api.chooseFontFile();
    if (!fontPath) return;

    // Read the raw bytes, base64-encoded
    const b64 = await window.api.readFontFile(fontPath);
    if (!b64) {
      showNotification("Failed to load font file.");
      return;
    }

    // Derive a font name and MIME type
    const filename = fontPath.split(/[\\/]/).pop()!;
    const fontName = filename.replace(/\.[^.]+$/, "");
    const ext = filename.split(".").pop()!.toLowerCase();
    const mime =
      ext === "ttf"
        ? "font/ttf"
        : ext === "otf"
          ? "font/otf"
          : ext === "woff"
            ? "font/woff"
            : ext === "woff2"
              ? "font/woff2"
              : "application/octet-stream";

    // Build the data: URI
    const dataUri = `data:${mime};base64,${b64}`;

    // Inject @font-face
    const rule = `
        @font-face {
          font-family: "${fontName}";
          src: url("${dataUri}") format("${ext}");
          font-weight: normal;
          font-style: normal;
        }
      `;
    const style = document.createElement("style");
    style.textContent = rule;
    document.head.append(style);

    // Apply immediately
    document.documentElement.style.setProperty(
      "--font-secondary",
      `"${fontName}", sans-serif`,
    );

    // Persist to config
    themeConfig.fontSecondary = "__file";
    themeConfig.fontSecondaryName = fontName;
    themeConfig.fontSecondaryFilePath = dataUri;

    await window.api.saveThemeConfig(themeConfig);

    showNotification("Secondary font loaded successfully");
  });

  const serverInfoConfig = document.querySelector<HTMLElement>(
    ".server-infos-configuration",
  );
  const serverInfoCheckbox = document.querySelector<HTMLInputElement>(
    "#server-infos-toggle",
  );
  if (serverInfoConfig && serverInfoCheckbox) {
    const setServerUI = (enabled: boolean) => {
      // stores toggle status
      serverInfoCheckbox.checked = enabled;
      // show/hide server status block
      serverInfoConfig.style.display = enabled ? "block" : "none";
      // show/hide every "refresh" buttons
      document
        .querySelectorAll<HTMLElement>(".config-main-button.refresh")
        .forEach((btn) => {
          btn.style.display = enabled ? "flex" : "none";
          console.log("test");
        });
    };

    // initial state from loaded config
    setServerUI(appConfig.serverInfoEnabled ?? true);
    // apply logic to each toggle
    serverInfoCheckbox.addEventListener("change", () => {
      setServerUI(serverInfoCheckbox.checked);
    });
  }

  const particlesCheckbox =
    document.querySelector<HTMLInputElement>("#particles-button")!;
  setParticlesControlsEnabled(themeConfig.particlesEnabled ?? true);
  particlesCheckbox.addEventListener("change", () => {
    setParticlesControlsEnabled(particlesCheckbox.checked);
  });

  const selectedTheme = "codex";
  themeStylesheet.setAttribute("href", `styles/${selectedTheme}.css`);
  updaterStylesheet.setAttribute(
    "href",
    `styles/UpdaterModal-${selectedTheme}.css`,
  );
  appConfigStylesheet.setAttribute(
    "href",
    `styles/AppConfigurationModal-${selectedTheme}.css`,
  );
  themeConfig.baseTheme = selectedTheme;

  const resetAppearanceButton = document.getElementById(
    "reset-appearance",
  ) as HTMLButtonElement;

  if (resetAppearanceButton) {
    resetAppearanceButton.addEventListener("click", async () => {
      const confirmed = await safePrompt(
        "Are you sure you want to reset all theme settings? This will erase your custom colors, fonts and backgrounds (games and client settings are not affected).",
      );
      if (!confirmed) return;

      themeConfig.background = "";
      themeConfig.backgrounds = [];
      themeConfig.backgroundColor = "#0e1a23";
      themeConfig.textColor = "#88c0a9";
      themeConfig.accentColor = "#98e4f7";
      themeConfig.buttonColorAlpha = 0.65;
      themeConfig.buttonColor = "#14141e";
      themeConfig.accentColor = "#98e4f7";
      themeConfig.buttonColorHoverAlpha = 0.95;
      themeConfig.buttonColorHover = "#28283c";
      themeConfig.fontPrimary = "";
      themeConfig.fontPrimaryUrl = "";
      themeConfig.fontSecondary = "";
      themeConfig.fontSecondaryUrl = "";
      themeConfig.particleOptions.color = "#63b0c4";
      themeConfig.particleOptions.alpha = 0.15;
      themeConfig.particleOptions.count = 100;
      themeConfig.particleOptions.speedYMax = 0.3;
      themeConfig.particleOptions.speedYMin = 0.1;

      document.body.style.backgroundColor = "";
      applyThemeConfig(themeConfig);

      await window.api.saveThemeConfig(themeConfig);
      showNotification("Appearance settings reset");
    });
  }

  const transitioningMenus: Map<string, boolean> = new Map();

  async function toggleMenu(
    selector: string,
    onOpen?: () => Promise<void> | void,
  ) {
    const menu = document.querySelector(selector) as HTMLDivElement;
    if (!menu) return;

    const currentTransition = transitioningMenus.get(selector) ?? false;
    if (currentTransition) {
      console.log(
        `[FVTT Client] Transition already in progress for ${selector}, abort toggle.`,
      );
      return;
    }

    if (menu.classList.contains("hidden2")) {
      transitioningMenus.set(selector, true);

      menu.classList.add("flex-display");
      void menu.offsetWidth;
      menu.classList.remove("hidden2");
      menu.classList.remove("hidden-display");
      menu.classList.add("show");

      if (onOpen) {
        await onOpen();
      }

      const computedStyle = window.getComputedStyle(menu);
      const transitionDuration =
        parseFloat(computedStyle.transitionDuration) || 0;

      if (transitionDuration > 0) {
        menu.addEventListener("transitionend", function handler(e) {
          if (e.propertyName === "opacity") {
            transitioningMenus.set(selector, false);
            menu.removeEventListener("transitionend", handler);
          }
        });
      } else {
        transitioningMenus.set(selector, false);
      }
    } else if (menu.classList.contains("show")) {
      transitioningMenus.set(selector, true);

      menu.classList.add("hidden2");

      const computedStyle = window.getComputedStyle(menu);
      const transitionDuration =
        parseFloat(computedStyle.transitionDuration) || 0;

      if (transitionDuration > 0) {
        menu.addEventListener("transitionend", function handler(e) {
          if (e.propertyName === "opacity") {
            menu.classList.remove("show");
            menu.classList.remove("flex-display");
            menu.classList.add("hidden-display");
            transitioningMenus.set(selector, false);
            menu.removeEventListener("transitionend", handler);
          }
        });
      } else {
        menu.classList.remove("show");
        menu.classList.remove("flex-display");
        menu.classList.add("hidden-display");
        transitioningMenus.set(selector, false);
      }
    }
  }

  async function openServerSettings(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const gameItem = target.closest(".game-item") as HTMLDivElement;
    if (!gameItem) return;

    const gameId = gameItem.dataset.gameId ?? null;
    const game = findGameByKey(gameId);
    if (!game) return;

    editingServerId = game.id ?? game.name;
    const loginData = (await window.api.userData(
      game.id ?? game.name,
    )) as GameUserDataDecrypted;

    serverSettingsNameField.value = game.name;
    serverSettingsUrlField.value = game.url;
    serverSettingsUserField.value = loginData.user;
    serverSettingsPasswordField.value = loginData.password;
    serverSettingsAdminPasswordField.value = loginData.adminPassword;
    serverSettingsDisableRefreshField.checked =
      game.serverInfoAutoRefreshDisabled ?? false;
    serverSettingsAutoLoginField.checked = game.autoLoginEnabled ?? true;
    editingServerAutorunItems = structuredClone(game.autorunFavorites ?? []);
    serverAutorunNameField.value = "";
    serverAutorunTargetField.value = "";
    renderServerAutorunList();

    serverSettingsPasswordField.type = "password";
    serverSettingsAdminPasswordField.type = "password";
    serverSettingsModal
      .querySelectorAll<HTMLButtonElement>(".toggle-password")
      .forEach((button) => {
        button.innerHTML = '<i class="fa-solid fa-eye"></i>';
      });

    serverSettingsModal.classList.remove("hidden-display");
    serverSettingsNameField.focus();
  }

  document.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest(
      ".config-main-button.config",
    ) as HTMLButtonElement | null;
    if (target) {
      void openServerSettings(event as MouseEvent);
    }
  });

  closeServerSettingsButton.addEventListener("click", closeServerSettings);

  serverSettingsModal.addEventListener("click", (event) => {
    if (event.target === serverSettingsModal) {
      closeServerSettings();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !serverSettingsModal.classList.contains("hidden-display")
    ) {
      closeServerSettings();
    }
  });

  saveServerSettingsButton.addEventListener("click", async () => {
    const game = findGameByKey(editingServerId);
    if (!game) return;

    const gameId = game.id ?? game.name;
    const newGameName = serverSettingsNameField.value.trim();
    const newGameUrl = serverSettingsUrlField.value.trim();
    const user = serverSettingsUserField.value;
    const password = serverSettingsPasswordField.value;
    const adminPassword = serverSettingsAdminPasswordField.value;
    const serverInfoAutoRefreshDisabled =
      serverSettingsDisableRefreshField.checked;
    const autoLoginEnabled = serverSettingsAutoLoginField.checked;

    if (!newGameName || !newGameUrl) {
      await safePrompt("Please enter a server name and URL.", {
        mode: "alert",
      });
      return;
    }

    await updateGameList((appConfig) => {
      const gameToUpdate = appConfig.games.find(
        (storedGame) => getGameKey(storedGame) === getGameKey(game),
      );
      if (gameToUpdate) {
        gameToUpdate.name = newGameName;
        gameToUpdate.url = newGameUrl;
        gameToUpdate.serverInfoAutoRefreshDisabled =
          serverInfoAutoRefreshDisabled;
        gameToUpdate.autoLoginEnabled = autoLoginEnabled;
        gameToUpdate.autorunFavorites = structuredClone(
          editingServerAutorunItems,
        );
      }
    });

    window.api.saveUserData({
      gameId,
      user,
      password,
      adminPassword,
    } as SaveUserData);

    closeServerSettings();
    await createGameList();
    const refreshedGame = findGameByKey(gameId);
    const refreshedItem = gameItemList.querySelector<HTMLElement>(
      `.game-item[data-game-id="${CSS.escape(String(gameId))}"]`,
    );
    if (refreshedGame && refreshedItem) {
      await refreshServerButtonBackground(refreshedItem, refreshedGame, {
        force: true,
      });
    }
    showNotification("Game settings saved");
  });

  deleteServerSettingsButton.addEventListener("click", async () => {
    const game = findGameByKey(editingServerId);
    if (!game) return;

    const confirmed = await safePrompt(
      "Are you sure you want to delete this game?",
    );
    if (!confirmed) return;

    await updateGameList((appConfig) => {
      appConfig.games = appConfig.games.filter(
        (storedGame) => getGameKey(storedGame) !== getGameKey(game),
      );
    });
    closeServerSettings();
    await createGameList();
    showNotification("Game deleted");
  });

  document.addEventListener("click", (event) => {
    // was refresh button clicked?
    const btn = (event.target as HTMLElement).closest(
      ".config-main-button.refresh",
    ) as HTMLButtonElement | null;
    if (!btn) return;

    // retrieve <li class="game-item">
    const li = btn.closest(".game-item") as HTMLElement | null;
    if (!li) return;

    // extract ID and retrieve correct config
    const key = li.dataset.gameId;
    const game = findGameByKey(key ?? null);
    if (!game) return;

    // animate spinner icon
    const icon = btn.querySelector("i");
    if (icon) {
      const originalClass = icon.className;
      icon.className = "fa-solid fa-spinner fa-spin";

      updateServerInfos(li, game)
        .catch((err) => {
          console.warn(`updateServerInfos failed for ${game.name}:`, err);
        })
        .finally(() => {
          showNotification("Server status refreshed");
          icon.className = originalClass;
        });
    } else {
      // fallback if no icon
      updateServerInfos(li, game).catch((err) => {
        console.warn(`updateServerInfos failed for ${game.name}:`, err);
      });
    }
  });

  document.getElementById("open-config")?.addEventListener("click", () => {
    ui.toggleAppConfig();
  });
  document
    .getElementById("open-theme")
    ?.addEventListener("click", () => toggleMenu(".theme-configuration"));
  document
    .getElementById("open-help")
    ?.addEventListener("click", () => toggleMenu(".help"));
  document
    .getElementById("close-help")
    ?.addEventListener("click", () => toggleMenu(".help"));
  document.getElementById("open-share")?.addEventListener("click", async () => {
    await toggleMenu("#share-menu", async () => {
      (document.getElementById("share-input")! as HTMLTextAreaElement).value =
        "";
      (document.getElementById("share-output")! as HTMLElement).textContent =
        "";
      hideShareSummary();
    });
  });
  document.getElementById("close-share")?.addEventListener("click", () => {
    (document.getElementById("share-input")! as HTMLTextAreaElement).value = "";
    (document.getElementById("share-output")! as HTMLElement).textContent = "";
    hideShareSummary();
    toggleMenu("#share-menu");
  });
  document.querySelector("#share-copy").addEventListener("click", async () => {
    const txt = document.getElementById("share-output")!.textContent;
    navigator.clipboard.writeText(txt);
    if (!txt) {
      return showNotification("Nothing to copy");
    }
    showNotification("Settings copied");
  });
  document
    .getElementById("export-settings")!
    .addEventListener("click", exportSettings);
  document
    .getElementById("share-apply-import")!
    .addEventListener("click", applyShareImport);
  document
    .getElementById("import-settings")!
    .addEventListener("click", importFromFile);
  document
    .getElementById("share-save-as")!
    .addEventListener("click", saveToFile);

  document.querySelectorAll<HTMLButtonElement>(".tab-button").forEach((btn) => {
    const tabId = btn.getAttribute("data-tab");
    if (!tabId) return;
    btn.addEventListener("click", (e) => switchTab(e as MouseEvent, tabId));
  });
});

// Export Settings
const appVersion = await window.api.appVersion();
type ShareSection =
  | "clientSettings"
  | "serverAddresses"
  | "serverCredentials"
  | "serverAutorunFavorites"
  | "globalFavorites"
  | "theme";

type ShareOptions = Record<ShareSection, boolean>;

type ExportedCredential = {
  adminPassword?: string;
  gameId?: GameId;
  password?: string;
  serverName?: string;
  serverUrl?: string;
  user?: string;
};

type SharePayload = {
  app?: Partial<AppConfig>;
  clientVersion?: string;
  credentials?: ExportedCredential[];
  exportedAt?: string;
  exportVersion?: number;
  sections?: Partial<ShareOptions>;
  theme?: Partial<ThemeConfig>;
};

type ImportDetection = {
  data: SharePayload;
  available: Partial<ShareOptions>;
};

type ImportSummary = {
  autorunFavorites: number;
  credentials: number;
  favorites: number;
  serversAdded: number;
  serversSkipped: number;
  settings: boolean;
  theme: boolean;
};

const shareSectionLabels: Record<ShareSection, string> = {
  clientSettings: "Client settings",
  serverAddresses: "Server addresses",
  serverCredentials: "Server usernames/passwords",
  serverAutorunFavorites: "Per-server autorun favourites",
  globalFavorites: "Main screen favourites",
  theme: "Theme",
};

const shareOptionIds: Record<ShareSection, string> = {
  clientSettings: "export-client-settings",
  serverAddresses: "export-server-addresses",
  serverCredentials: "export-server-credentials",
  serverAutorunFavorites: "export-server-autorun",
  globalFavorites: "export-global-favorites",
  theme: "export-theme",
};

function getChecked(id: string) {
  return (document.getElementById(id) as HTMLInputElement | null)?.checked;
}

function getExportOptions(): ShareOptions {
  return {
    clientSettings: !!getChecked(shareOptionIds.clientSettings),
    serverAddresses: !!getChecked(shareOptionIds.serverAddresses),
    serverCredentials: !!getChecked(shareOptionIds.serverCredentials),
    serverAutorunFavorites: !!getChecked(shareOptionIds.serverAutorunFavorites),
    globalFavorites: !!getChecked(shareOptionIds.globalFavorites),
    theme: !!getChecked(shareOptionIds.theme),
  };
}

function selectedSections(options: Partial<ShareOptions>) {
  return (Object.entries(options) as [ShareSection, boolean][])
    .filter(([, enabled]) => enabled)
    .map(([section]) => shareSectionLabels[section]);
}

function showShareSummary(title: string, lines: string[]) {
  const summary = document.getElementById("share-summary") as HTMLElement | null;
  if (!summary) return;
  summary.innerHTML = "";

  const heading = document.createElement("strong");
  heading.textContent = title;
  summary.append(heading);

  const list = document.createElement("ul");
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  summary.append(list);
  summary.classList.remove("hidden-display");
}

function hideShareSummary() {
  const summary = document.getElementById("share-summary") as HTMLElement | null;
  if (!summary) return;
  summary.innerHTML = "";
  summary.classList.add("hidden-display");
}

function cleanThemeForSharing(rawTheme: ThemeConfig) {
  const parsed = ThemeConfigSchema.parse(rawTheme);
  const cleanTheme = { ...parsed };
  delete cleanTheme.fontPrimaryName;
  delete cleanTheme.fontPrimaryFilePath;
  delete cleanTheme.fontSecondaryName;
  delete cleanTheme.fontSecondaryFilePath;
  return cleanTheme;
}

function appSettingsForSharing(app: AppConfig): Partial<AppConfig> {
  const settings = { ...app };
  delete settings.games;
  delete settings.favorites;
  delete settings.windowBounds;
  return settings;
}

function gameForSharing(game: GameConfig, includeAutorun: boolean): GameConfig {
  return {
    ...game,
    autorunFavorites: includeAutorun ? (game.autorunFavorites ?? []) : [],
  };
}

function favoriteKey(favorite: FavoriteConfig) {
  return [
    favorite.type ?? "website",
    favorite.url ?? "",
    favorite.filePath ?? "",
    favorite.name ?? "",
  ].join("|");
}

function serverUrlKey(game: Partial<GameConfig>) {
  return String(game.url ?? "").trim().toLowerCase();
}

function hasFavoriteData(favorites: unknown): favorites is FavoriteConfig[] {
  return Array.isArray(favorites) && favorites.length > 0;
}

function hasAutorunData(games: unknown): games is GameConfig[] {
  return (
    Array.isArray(games) &&
    games.some(
      (game) =>
        Array.isArray((game as GameConfig).autorunFavorites) &&
        ((game as GameConfig).autorunFavorites?.length ?? 0) > 0,
    )
  );
}

function hasClientSettingsData(app: Partial<AppConfig> | undefined) {
  if (!app) return false;
  return Object.keys(app).some(
    (key) => !["games", "favorites"].includes(key),
  );
}

async function collectCredentials(games: GameConfig[]) {
  const credentials: ExportedCredential[] = [];

  for (const game of games) {
    const gameId = game.id ?? game.name;
    if (gameId === undefined || gameId === null) continue;
    const login = await window.api.userData(gameId);
    if (!login.user && !login.password && !login.adminPassword) continue;
    credentials.push({
      gameId,
      serverName: game.name,
      serverUrl: game.url,
      user: login.user,
      password: login.password,
      adminPassword: login.adminPassword,
    });
  }

  return credentials;
}

async function exportSettings() {
  const options = getExportOptions();
  if (!Object.values(options).some(Boolean)) {
    await safePrompt("Choose at least one thing to export.", { mode: "alert" });
    return;
  }

  if (options.serverCredentials) {
    const confirmed = await safePrompt(
      "This export will include server usernames and passwords in readable text. Only share it with people you trust. Continue?",
    );
    if (!confirmed) return;
  }

  const app = await window.api.localAppConfig();
  const payload: SharePayload = {
    clientVersion: appVersion,
    exportedAt: new Date().toISOString(),
    exportVersion: 1,
    sections: options,
  };

  if (
    options.clientSettings ||
    options.serverAddresses ||
    options.globalFavorites
  ) {
    payload.app = {};
  }
  if (options.clientSettings) {
    Object.assign(payload.app!, appSettingsForSharing(app));
  }
  if (options.serverAddresses) {
    payload.app!.games = (app.games ?? []).map((game) =>
      gameForSharing(game, options.serverAutorunFavorites),
    );
  }
  if (options.globalFavorites) {
    payload.app!.favorites = app.favorites ?? [];
  }
  if (options.serverCredentials) {
    payload.credentials = await collectCredentials(app.games ?? []);
  }
  if (options.theme) {
    payload.theme = cleanThemeForSharing(await window.api.localThemeConfig());
  }

  document.getElementById("share-output")!.textContent = JSON.stringify(
    payload,
    null,
    2,
  );

  const summary = selectedSections(options);
  if (options.serverCredentials) {
    summary.push(`${payload.credentials?.length ?? 0} credential records`);
  }
  showShareSummary("Export ready", summary);
  showNotification("Export ready");
}

function normalizeSharePayload(data: any): ImportDetection | null {
  if (!data || typeof data !== "object") return null;
  const payload: SharePayload = { ...data };

  if (!payload.theme && typeof data.backgroundColor !== "undefined") {
    payload.theme = data;
  }

  const available: Partial<ShareOptions> = {};
  if (hasClientSettingsData(payload.app)) available.clientSettings = true;
  if (Array.isArray(payload.app?.games) && payload.app.games.length > 0) {
    available.serverAddresses = true;
  }
  if (Array.isArray(payload.credentials) && payload.credentials.length > 0) {
    available.serverCredentials = true;
  }
  if (hasAutorunData(payload.app?.games)) {
    available.serverAutorunFavorites = true;
  }
  if (hasFavoriteData(payload.app?.favorites)) {
    available.globalFavorites = true;
  }
  if (payload.theme && typeof payload.theme === "object") {
    available.theme = true;
  }

  return Object.values(available).some(Boolean) ? { data: payload, available } : null;
}

function showImportOptionsDialog(available: Partial<ShareOptions>) {
  return new Promise<ShareOptions | null>((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay flex-display share-import-overlay";

    const modal = document.createElement("div");
    modal.className = "share-import-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const heading = document.createElement("h2");
    heading.textContent = "Choose What To Import";
    modal.append(heading);

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "share-import-options";
    const inputs = new Map<ShareSection, HTMLInputElement>();

    (Object.keys(shareSectionLabels) as ShareSection[]).forEach((section) => {
      if (!available[section]) return;
      const label = document.createElement("label");
      label.className = "share-option";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = true;
      inputs.set(section, input);

      const text = document.createElement("span");
      text.textContent = shareSectionLabels[section];
      label.append(input, text);
      optionsWrap.append(label);
    });

    modal.append(optionsWrap);

    const actions = document.createElement("div");
    actions.className = "server-settings-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = "Import Selected";
    actions.append(cancel, confirm);
    modal.append(actions);
    overlay.append(modal);
    document.body.append(overlay);

    const cleanup = () => overlay.remove();
    cancel.addEventListener("click", () => {
      cleanup();
      resolve(null);
    });
    confirm.addEventListener("click", () => {
      const selected = {} as ShareOptions;
      (Object.keys(shareSectionLabels) as ShareSection[]).forEach((section) => {
        selected[section] = inputs.get(section)?.checked ?? false;
      });
      cleanup();
      resolve(selected);
    });
  });
}

async function confirmImportRisks(options: ShareOptions) {
  if (options.serverCredentials) {
    const confirmed = await safePrompt(
      "This import includes server usernames and passwords. Only import credentials from sources you trust. Continue?",
    );
    if (!confirmed) return false;
  }

  if (options.globalFavorites || options.serverAutorunFavorites) {
    const confirmed = await safePrompt(
      "Favourites can open websites or local files. Only import favourites and autorun favourites from trusted sources. Continue?",
    );
    if (!confirmed) return false;
  }

  return true;
}

async function applyThemeImport(theme: Partial<ThemeConfig>) {
  const themeStylesheet = document.getElementById(
    "theme-stylesheet",
  ) as HTMLLinkElement;
  const updaterStylesheet = document.getElementById(
    "updater-stylesheet",
  ) as HTMLLinkElement;
  const appConfigStylesheet = document.getElementById(
    "client-settings-stylesheet",
  ) as HTMLLinkElement;

  const mergedTheme = await mergeThemeData(theme);
  mergedTheme.baseTheme = "codex";
  await window.api.saveThemeConfig(mergedTheme);
  applyThemeConfig(mergedTheme);
  themeStylesheet.href = "styles/codex.css";
  updaterStylesheet.setAttribute("href", "styles/UpdaterModal-codex.css");
  appConfigStylesheet.setAttribute(
    "href",
    "styles/AppConfigurationModal-codex.css",
  );
}

async function removeUnavailableImportedFileFavorites(app: Partial<AppConfig>) {
  const favoritesToImport = app.favorites ?? [];
  const availableFavorites: FavoriteConfig[] = [];
  const gamesToImport = app.games;

  for (const favorite of favoritesToImport) {
    if (!isFileFavorite(favorite)) {
      availableFavorites.push(favorite);
      continue;
    }

    const filePath = favorite.filePath ?? "";
    if (filePath && (await window.api.localPathExists(filePath))) {
      availableFavorites.push(favorite);
    }
  }

  const availableGames = gamesToImport
    ? await Promise.all(
        gamesToImport.map(async (game) => {
          const autorunFavorites: FavoriteConfig[] = [];

          for (const favorite of game.autorunFavorites ?? []) {
            if (!isFileFavorite(favorite)) {
              autorunFavorites.push(favorite);
              continue;
            }

            const filePath = favorite.filePath ?? "";
            if (filePath && (await window.api.localPathExists(filePath))) {
              autorunFavorites.push(favorite);
            }
          }

          return {
            ...game,
            autorunFavorites,
          };
        }),
      )
    : undefined;

  return {
    ...app,
    ...(availableGames ? { games: availableGames } : {}),
    favorites: availableFavorites,
  };
}

async function mergeImportedAppData(app: Partial<AppConfig>) {
  return mergeAppData(await removeUnavailableImportedFileFavorites(app));
}

function mergeFavorites(existing: FavoriteConfig[], incoming: FavoriteConfig[]) {
  const seen = new Set(existing.map(favoriteKey));
  const merged = [...existing];
  let added = 0;

  for (const favorite of incoming) {
    const key = favoriteKey(favorite);
    if (seen.has(key)) continue;
    merged.push(favorite);
    seen.add(key);
    added += 1;
  }

  return { added, favorites: merged };
}

async function applySharePayload(
  payload: SharePayload,
  options: ShareOptions,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    autorunFavorites: 0,
    credentials: 0,
    favorites: 0,
    serversAdded: 0,
    serversSkipped: 0,
    settings: false,
    theme: false,
  };

  if (options.theme && payload.theme) {
    await applyThemeImport(payload.theme);
    summary.theme = true;
  }

  const currentApp = await window.api.localAppConfig();
  let nextApp: AppConfig = { ...currentApp };
  const importedApp = await removeUnavailableImportedFileFavorites(
    payload.app ?? {},
  );

  if (options.clientSettings && payload.app) {
    const clientSettings = { ...payload.app };
    delete clientSettings.games;
    delete clientSettings.favorites;
    nextApp = await mergeImportedAppData(clientSettings);
    summary.settings = true;
  }

  if (options.serverAddresses && Array.isArray(importedApp.games)) {
    const existingUrls = new Set((nextApp.games ?? []).map(serverUrlKey));
    const games = [...(nextApp.games ?? [])];

    for (const importedGame of importedApp.games) {
      const urlKey = serverUrlKey(importedGame);
      if (!urlKey || existingUrls.has(urlKey)) {
        summary.serversSkipped += 1;
        continue;
      }

      const gameToImport = { ...importedGame };
      if (!options.serverAutorunFavorites) {
        delete gameToImport.autorunFavorites;
      }
      games.push(gameToImport);
      existingUrls.add(urlKey);
      summary.serversAdded += 1;
      summary.autorunFavorites += gameToImport.autorunFavorites?.length ?? 0;
    }
    nextApp = { ...nextApp, games };
  }

  if (options.globalFavorites && Array.isArray(importedApp.favorites)) {
    const result = mergeFavorites(nextApp.favorites ?? [], importedApp.favorites);
    nextApp = { ...nextApp, favorites: result.favorites };
    summary.favorites = result.added;
  }

  await window.api.saveAppConfig(nextApp);
  await applyRuntimeAppConfig(nextApp);

  if (options.serverCredentials && Array.isArray(payload.credentials)) {
    for (const credential of payload.credentials) {
      const matchedGame =
        nextApp.games?.find(
          (game) =>
            serverUrlKey(game) ===
              String(credential.serverUrl ?? "").trim().toLowerCase() ||
            String(game.id ?? "") === String(credential.gameId ?? ""),
        ) ?? null;
      const gameId = matchedGame?.id ?? matchedGame?.name ?? credential.gameId;
      if (gameId === undefined || gameId === null) continue;
      window.api.saveUserData({
        gameId,
        user: credential.user ?? "",
        password: credential.password ?? "",
        adminPassword: credential.adminPassword ?? "",
      });
      summary.credentials += 1;
    }
  }

  await createGameList();
  return summary;
}

function summarizeImport(summary: ImportSummary, options: ShareOptions) {
  const lines: string[] = [];
  if (summary.settings) lines.push("Client settings imported");
  if (options.serverAddresses) {
    lines.push(
      `${summary.serversAdded} servers added, ${summary.serversSkipped} skipped`,
    );
  }
  if (options.globalFavorites) {
    lines.push(`${summary.favorites} main screen favourites added`);
  }
  if (options.serverAutorunFavorites) {
    lines.push(
      `${summary.autorunFavorites} autorun favourites kept on imported servers`,
    );
  }
  if (options.serverCredentials) {
    lines.push(`${summary.credentials} credential records imported`);
  }
  if (summary.theme) lines.push("Theme settings imported");
  return lines.length > 0 ? lines : ["No selected data was imported"];
}

async function importShareText(txt: string, sourceLabel: string) {
  let data: any;
  try {
    data = JSON.parse(txt);
  } catch {
    await safePrompt("Invalid JSON data.", { mode: "alert" });
    return;
  }

  const detected = normalizeSharePayload(data);
  if (!detected) {
    await safePrompt(`Could not recognise ${sourceLabel} format.`, {
      mode: "alert",
    });
    return;
  }

  const options = await showImportOptionsDialog(detected.available);
  if (!options || !Object.values(options).some(Boolean)) return;
  if (!(await confirmImportRisks(options))) return;

  const summary = await applySharePayload(detected.data, options);
  showShareSummary("Import complete", summarizeImport(summary, options));
  showNotification("Import complete");
}

async function applyShareImport() {
  const txt = (document.getElementById("share-input") as HTMLTextAreaElement)
    .value;
  await importShareText(txt, "text");
}

async function importFromFile() {
  const fileInput = document.getElementById("import-file") as HTMLInputElement;
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await importShareText(await file.text(), "file");
    fileInput.value = "";
  };
  fileInput.click();
}

async function saveToFile() {
  // Gets the JSON data displayed in share-output
  const outputEl = document.getElementById("share-output") as HTMLElement;
  const text = outputEl.textContent ?? "";
  if (!text) {
    return showNotification("Nothing to save");
  }

  // Create a JSON Blob
  const blob = new Blob([text], { type: "application/json" });

  // Create temporary URL
  const url = URL.createObjectURL(blob);

  // Dynamically create a <a> to force a download
  const a = document.createElement("a");
  a.href = url;

  // Picks a file name depending on JSON content
  // Checks if it's a full export (app+theme) or theme only
  let filename = "export";
  try {
    const data = JSON.parse(text);
    if (data.app && data.theme) {
      filename = "settings";
    } else {
      filename = "theme";
    }
  } catch {
    filename = "export";
  }
  a.download = `${filename}.json`;

  // Download and clean up
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNotification(`Saved ${a.download}`);
}

function switchTab(event: MouseEvent, tabId: string): void {
  event.preventDefault();
  const tabs = document.querySelectorAll<HTMLButtonElement>(".tab-button");
  const contents = document.querySelectorAll<HTMLElement>(".tab-content");

  tabs.forEach((t) => t.classList.remove("active"));
  contents.forEach((c) => {
    c.classList.remove("active");
    c.style.display = "none";
  });

  (event.currentTarget as HTMLElement).classList.add("active");

  const target = document.getElementById(`tab-${tabId}`);
  if (!target) return;
  target.style.display = "flex";
  void target.offsetWidth; // force repaint
  target.classList.add("active");
}

async function createGameItem(game: GameConfig) {
  const li = document.importNode(gameItemTemplate, true);

  li.id = game.cssId;
  li.setAttribute("data-game-id", getGameKey(game));
  li.querySelector("a").innerText = game.name;
  setupServerReorder(li);
  void applyCachedServerButtonBackground(li, game);
  li.querySelector(".game-main-button").addEventListener("click", async () => {
    const appConfig: AppConfig = await window.api.localAppConfig();
    const savedGame = appConfig.games?.find(
      (storedGame) => String(storedGame.id) === String(game.id),
    );
    const shouldAutoLogin =
      savedGame?.autoLoginEnabled ?? game.autoLoginEnabled ?? true;
    window.api.openGame(game.id ?? game.name, game.name, shouldAutoLogin);
    openAutorunItems(savedGame?.autorunFavorites ?? game.autorunFavorites);
    await refreshServerButtonBackground(li, game);
    if (appConfig.discordRP) {
      if (window.richPresence?.enable) {
        window.richPresence.enable();
      }
    }
    window.location.href = game.url;
  });
  gameItemList.appendChild(li);
  if (!game.serverInfoAutoRefreshDisabled) {
    await updateServerInfos(li, game);
  }

  // Retrieve app config from userData
  const appConfig = await window.api.localAppConfig();
  // Hide or display each "Refresh server" button
  document
    .querySelectorAll<HTMLElement>(".config-main-button.refresh")
    .forEach((btn) => {
      btn.style.display =
        (appConfig.serverInfoEnabled ?? true) ? "flex" : "none";
    });

  renderTooltips();
  return li;
}

function applyThemeConfig(config: ThemeConfig) {
  const primaryFontSelect = document.querySelector<HTMLSelectElement>(
    "#primary-font-selector",
  )!;
  const customPrimaryField = document.querySelector<HTMLInputElement>(
    "#primary-custom-font",
  )!;
  const primaryImportField = document.getElementById("primary-import-font")!;
  const secondaryFontSelect = document.querySelector<HTMLSelectElement>(
    "#secondary-font-selector",
  )!;
  const customSecondaryField = document.querySelector<HTMLInputElement>(
    "#secondary-custom-font",
  )!;
  const secondaryImportField = document.getElementById(
    "secondary-import-font",
  )!;

  const particlesCheckbox = (document.querySelector(
    "#particles-button",
  ) as HTMLInputElement)!;

  primaryFontSelect.value = config.fontPrimary ?? "";
  customPrimaryField.value = config.fontPrimaryUrl ?? "";
  secondaryFontSelect.value = config.fontSecondary ?? "";
  customSecondaryField.value = config.fontSecondaryUrl ?? "";

  const particlesCheckboxEnabled = config.particlesEnabled ?? true;
  particlesCheckbox.checked = particlesCheckboxEnabled;

  customPrimaryField.style.display =
    primaryFontSelect.value === "__custom" ? "flex" : "none";
  customPrimaryField.parentElement!.style.display =
    primaryFontSelect.value === "__custom" ? "flex" : "none";
  primaryImportField.style.display =
    primaryFontSelect.value === "__file" ? "block" : "none";
  primaryImportField.parentElement!.style.display =
    primaryFontSelect.value === "__file" ? "flex" : "none";
  customSecondaryField.style.display =
    secondaryFontSelect.value === "__custom" ? "flex" : "none";
  customSecondaryField.parentElement!.style.display =
    secondaryFontSelect.value === "__custom" ? "flex" : "none";
  secondaryImportField.style.display =
    secondaryFontSelect.value === "__file" ? "block" : "none";
  secondaryImportField.parentElement!.style.display =
    secondaryFontSelect.value === "__file" ? "flex" : "none";

  setParticlesControlsEnabled(particlesCheckboxEnabled);

  // Primary font modes: Google, Local file (data URI), or built-in
  if (config.fontPrimary === "__custom" && config.fontPrimaryUrl) {
    // Google Fonts via <link>
    useGoogleFont(config.fontPrimaryUrl, "primary");
    const fam = extractFamilyName(config.fontPrimaryUrl);
    document.documentElement.style.setProperty(
      "--font-primary",
      fam ? `'${fam}',sans-serif` : "",
    );
  } else if (config.fontPrimary === "__file" && config.fontPrimaryFilePath) {
    // Local file font injected as data URI
    useGoogleFont("", "primary");
    // Assume config.fontPrimaryFilePath contains full data: URI
    // Derive a name from FontConfig or store in config.fontPrimaryName if you like
    const fontName = config.fontPrimaryName ?? "LocalFont";
    // Inject the @font-face rule if not already present
    if (!document.getElementById(`ff-${fontName}`)) {
      const style = document.createElement("style");
      style.id = `ff-${fontName}`;
      style.textContent = `
        @font-face {
          font-family: "${fontName}";
          src: url("${config.fontPrimaryFilePath}") format("truetype");
          font-weight: normal;
          font-style: normal;
        }
      `;
      document.head.append(style);
    }
    // Finally set the CSS variable
    document.documentElement.style.setProperty(
      "--font-primary",
      `"${fontName}",sans-serif`,
    );
  } else {
    // Built-in font names or none
    useGoogleFont("", "primary");
    if (
      config.fontPrimary &&
      config.fontPrimary !== "__custom" &&
      config.fontPrimary !== "__file"
    ) {
      document.documentElement.style.setProperty(
        "--font-primary",
        config.fontPrimary,
      );
    } else {
      document.documentElement.style.removeProperty("--font-primary");
    }
  }

  // Secondary font modes: Google, Local file (data URI), or built-in
  if (config.fontSecondary === "__custom" && config.fontSecondaryUrl) {
    // Google Fonts via <link>
    useGoogleFont(config.fontSecondaryUrl, "secondary");
    const fam = extractFamilyName(config.fontSecondaryUrl);
    document.documentElement.style.setProperty(
      "--font-secondary",
      fam ? `'${fam}',sans-serif` : "",
    );
  } else if (
    config.fontSecondary === "__file" &&
    config.fontSecondaryFilePath
  ) {
    // Local file font injected as data URI
    useGoogleFont("", "secondary");
    // Assume config.fontSecondaryFilePath contains full data: URI
    // Derive a name from FontConfig or store in config.fontSecondaryName if you like
    const fontName = config.fontSecondaryName ?? "LocalFont";
    // Inject the @font-face rule if not already present
    if (!document.getElementById(`ff-${fontName}`)) {
      const style = document.createElement("style");
      style.id = `ff-${fontName}`;
      style.textContent = `
        @font-face {
          font-family: "${fontName}";
          src: url("${config.fontSecondaryFilePath}") format("truetype");
          font-weight: normal;
          font-style: normal;
        }
      `;
      document.head.append(style);
    }
    // Finally set the CSS variable
    document.documentElement.style.setProperty(
      "--font-secondary",
      `"${fontName}",sans-serif`,
    );
  } else {
    // Built-in font names or none
    useGoogleFont("", "secondary");
    if (
      config.fontSecondary &&
      config.fontSecondary !== "__custom" &&
      config.fontSecondary !== "__file"
    ) {
      document.documentElement.style.setProperty(
        "--font-secondary",
        config.fontSecondary,
      );
    } else {
      document.documentElement.style.removeProperty("--font-secondary");
    }
  }

  (document.querySelector("#accent-color") as HTMLInputElement).value =
    "#98e4f7";
  (document.querySelector("#background-color") as HTMLInputElement).value =
    "#0e1a23";
  (document.querySelector("#text-color") as HTMLInputElement).value = "#88c0a9";
  const alphaInput = document.querySelector(
    "#button-color-alpha",
  ) as HTMLInputElement;
  alphaInput.valueAsNumber = 0.65;
  (document.querySelector("#button-color") as HTMLInputElement).value =
    "#14141e";
  const alphaHoverInput = document.querySelector(
    "#button-color-hover-alpha",
  ) as HTMLInputElement;
  alphaHoverInput.valueAsNumber = 0.95;
  (document.querySelector("#button-color-hover") as HTMLInputElement).value =
    "#28283c";

  const opts = config.particleOptions!;

  (
    document.querySelector("#particles-count") as HTMLInputElement
  ).valueAsNumber = opts.count;
  (
    document.querySelector("#particles-speed") as HTMLInputElement
  ).valueAsNumber = opts.speedYMax;
  (document.querySelector("#particles-color") as HTMLInputElement).value =
    opts.color;
  (
    document.querySelector("#particles-color-alpha") as HTMLInputElement
  ).valueAsNumber = opts.alpha;

  document.body.style.backgroundImage = "";
  const bgInput = document.querySelector(
    "#background-image",
  ) as HTMLInputElement;
  if (config.background) {
    document.body.style.backgroundImage = `url(${config.background})`;
    bgInput.value = config.background;
  } else {
    bgInput.value = "";
  }
  if (!config.background && config.backgrounds?.length) {
    const i = Math.floor(Math.random() * config.backgrounds.length);
    document.body.style.backgroundImage = `url(${config.backgrounds[i]})`;
  }
  if (config.textColor) {
    document.documentElement.style.setProperty(
      "--color-text-primary",
      config.textColor,
    );
    (document.querySelector("#text-color") as HTMLInputElement).value =
      config.textColor.substring(0, 7);
  }
  if (config.backgroundColor) {
    document.documentElement.style.setProperty(
      "--color-background",
      config.backgroundColor,
    );
    (document.querySelector("#background-color") as HTMLInputElement).value =
      config.backgroundColor.substring(0, 7);
  }
  if (config.accentColor) {
    document.documentElement.style.setProperty(
      "--color-accent",
      config.accentColor,
    );
    (document.querySelector("#accent-color") as HTMLInputElement).value =
      config.accentColor.substring(0, 7);
  }
  if (config.buttonColorAlpha != null) {
    const alphaStr = config.buttonColorAlpha.toString();

    document.documentElement.style.setProperty("--opacity-button", alphaStr);
    const inputAlpha = document.querySelector(
      "#button-color-alpha",
    ) as HTMLInputElement;
    inputAlpha.valueAsNumber = config.buttonColorAlpha;
  }
  if (config.buttonColor) {
    document.documentElement.style.setProperty(
      "--color-button",
      config.buttonColor,
    );
    (document.querySelector("#button-color") as HTMLInputElement).value =
      config.buttonColor;
  }
  const rgba = hexToRgba(config.buttonColor, config.buttonColorAlpha);
  document.documentElement.style.setProperty("--color-button-rgba", rgba);

  if (config.buttonColorHoverAlpha != null) {
    const alphaStr = config.buttonColorHoverAlpha.toString();

    document.documentElement.style.setProperty(
      "--opacity-button-hover",
      alphaStr,
    );
    const inputAlpha = document.querySelector(
      "#button-color-hover-alpha",
    ) as HTMLInputElement;
    inputAlpha.valueAsNumber = config.buttonColorHoverAlpha;
  }
  if (config.buttonColorHover) {
    document.documentElement.style.setProperty(
      "--color-button-hover",
      config.buttonColorHover,
    );
    (document.querySelector("#button-color-hover") as HTMLInputElement).value =
      config.buttonColorHover;
  }
  const rgbaHover = hexToRgba(
    config.buttonColorHover,
    config.buttonColorHoverAlpha,
  );
  document.documentElement.style.setProperty(
    "--color-button-hover-rgba",
    rgbaHover,
  );

  const enabled = config.particlesEnabled ?? true;
  const checkbox = (document.querySelector(
    "#particles-button",
  ) as HTMLInputElement)!;
  checkbox.checked = enabled;

  if (!enabled) {
    if (particles.isParticlesRunning()) {
      particles.stopParticles();
    }
    lastParticleOptions = null;
    return;
  }

  // Calculates Switch Label color from accentColor
  const accent = config.accentColor;
  const labelColor = getContrastColor(accent);
  document.documentElement.style.setProperty(
    "--switch-label-color",
    labelColor,
  );

  const sameOpts =
    lastParticleOptions !== null &&
    opts.count === lastParticleOptions.count &&
    opts.speedYMin === lastParticleOptions.speedYMin &&
    opts.speedYMax === lastParticleOptions.speedYMax &&
    opts.color === lastParticleOptions.color &&
    opts.alpha === lastParticleOptions.alpha;

  if (!particles.isParticlesRunning() || !sameOpts) {
    if (particles.isParticlesRunning()) {
      particles.stopParticles();
    }
    particles.configureParticles(opts);
    particles.startParticles();
    lastParticleOptions = { ...opts };
  }
}

function addStyle(styleString: string) {
  const style = document.createElement("style");
  style.textContent = styleString;
  document.head.append(style);
}

async function migrateConfig() {
  let localAppConfig = await window.api.localAppConfig();
  const gameList: GameConfig[] = JSON.parse(
    window.localStorage.getItem("gameList") || "[]",
  );
  if (gameList.length > 0) {
    localAppConfig.games = localAppConfig?.games ?? [];
    localAppConfig.games.push(...gameList);
    window.localStorage.removeItem("gameList");
  }
  const oldConfigJson = window.localStorage.getItem("appConfig") || "{}";
  if (oldConfigJson !== "{}") {
    const oldConfig = JSON.parse(oldConfigJson) as AppConfig;
    localAppConfig = { ...localAppConfig, ...oldConfig };
    window.localStorage.removeItem("appConfig");
  }
  await window.api.saveAppConfig(localAppConfig);
}

function renderTooltips() {
  const layer = document.getElementById("tooltip-layer");
  if (!layer) return;

  document.querySelectorAll(".tooltip-wrapper").forEach((wrapper) => {
    const wrapperElement = wrapper as HTMLElement;
    const tooltip = wrapper.querySelector<HTMLElement>(".tooltip");
    if (!tooltip) return;
    if (wrapperElement.dataset.tooltipBound === "true") return;
    wrapperElement.dataset.tooltipBound = "true";

    // tries to find an input of type range
    const input = wrapper.querySelector<HTMLInputElement>("input[type=range]");

    wrapper.addEventListener("mouseenter", () => {
      const rect = wrapper.getBoundingClientRect();
      const clone = tooltip.cloneNode(true) as HTMLElement;
      clone.classList.add("active-tooltip");
      clone.style.display = "block";
      clone.style.position = "fixed";
      clone.style.pointerEvents = "none";
      clone.style.transform = "none";
      clone.style.left = `${rect.left + rect.width / 2}px`;
      clone.style.top = `${rect.bottom + 5}px`;

      const baseText = tooltip.textContent?.trim() ?? "";

      // If input type is range, tooltip is live updated
      let onInput: (() => void) | null = null;
      if (input) {
        clone.textContent = `${baseText}: ${input.value}`;
        onInput = () => {
          clone.textContent = `${baseText}: ${input.value}`;
        };
        input.addEventListener("input", onInput);
      }

      layer.appendChild(clone);
      const cloneRect = clone.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, rect.left + rect.width / 2 - cloneRect.width / 2),
        window.innerWidth - cloneRect.width - 8,
      );
      clone.style.left = `${left}px`;

      // On mouseleave, clean clone and listener
      wrapper.addEventListener(
        "mouseleave",
        () => {
          clone.remove();
          if (input && onInput) {
            input.removeEventListener("input", onInput);
          }
        },
        { once: true },
      );
    });
  });
}

function applyButtonTooltips() {
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    if (button.dataset.skipAutoTooltip === "true") return;
    if (button.title) return;

    const wrapperTooltip = button
      .closest(".tooltip-wrapper")
      ?.querySelector<HTMLElement>(".tooltip")
      ?.textContent?.trim();
    if (wrapperTooltip) {
      button.removeAttribute("title");
      return;
    }
    const label =
      button.getAttribute("aria-label") || button.textContent?.trim();

    if (label) {
      button.title = label.replace(/\s+/g, " ");
    }
  });
}

function setupFavoriteDetailTooltip(
  item: HTMLElement,
  favorite: FavoriteConfig,
) {
  const layer = document.getElementById("tooltip-layer");
  let tooltip: HTMLElement | null = null;
  let hoverTimer: number | null = null;

  const clearTooltip = () => {
    if (hoverTimer) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    tooltip?.remove();
    tooltip = null;
  };

  item.addEventListener("mouseenter", () => {
    clearTooltip();
    hoverTimer = window.setTimeout(() => {
      if (!layer) return;
      const rect = item.getBoundingClientRect();
      tooltip = document.createElement("div");
      tooltip.className = "active-tooltip favorite-detail-tooltip";

      const name = document.createElement("div");
      name.className = "favorite-detail-name";
      name.textContent = favorite.name;
      const url = document.createElement("div");
      url.className = "favorite-detail-url";
      url.textContent = getFavoriteTarget(favorite);
      tooltip.append(name, url);

      tooltip.style.display = "block";
      tooltip.style.position = "fixed";
      tooltip.style.pointerEvents = "none";
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.bottom + 7}px`;
      layer.appendChild(tooltip);
    }, 1000);
  });

  item.addEventListener("mouseleave", clearTooltip);
}

async function createFavoriteList() {
  const appConfig = await window.api.localAppConfig();
  favorites = appConfig.favorites ?? [];
  document
    .querySelector("#favorites-section")
    ?.classList.toggle("favorites-empty", favorites.length === 0);
  favoriteList.replaceChildren();

  for (const favorite of favorites) {
    const li = document.createElement("li");
    li.className = "favorite-item";
    li.dataset.favoriteId = getFavoriteKey(favorite);
    li.draggable = mainEditModeEnabled;
    setupFavoriteReorder(li);
    setupFavoriteDetailTooltip(li, favorite);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "favorite-open-button";
    openButton.dataset.skipAutoTooltip = "true";
    openButton.setAttribute("aria-label", `Open ${favorite.name}`);
    openButton.addEventListener("click", () => {
      if (isFileFavorite(favorite)) {
        const filePath = favorite.filePath;
        if (filePath) window.api.openLocalPath(filePath);
        return;
      }
      const url = favorite.url;
      if (url) window.api.openDefaultBrowser(url);
    });

    const icon = document.createElement("span");
    icon.className = "favorite-icon";
    const customIconUrl = favorite.iconOverrideUrl;
    const fileIconUrl =
      !customIconUrl && isFileFavorite(favorite) && favorite.filePath
        ? await window.api.localFileIcon(favorite.filePath)
        : "";
    const faviconUrl =
      !customIconUrl && !fileIconUrl && !isFileFavorite(favorite)
        ? favorite.iconUrl || getFaviconUrl(favorite.url ?? "")
        : "";
    const iconUrl = customIconUrl || fileIconUrl || faviconUrl;
    if (iconUrl) {
      const image = document.createElement("img");
      image.src = iconUrl;
      image.alt = "";
      image.className =
        customIconUrl || fileIconUrl
          ? "favorite-icon-image"
          : "favorite-favicon";
      image.addEventListener("error", async () => {
        const fallbackFileIconUrl =
          customIconUrl && isFileFavorite(favorite) && favorite.filePath
            ? await window.api.localFileIcon(favorite.filePath)
            : "";
        if (fallbackFileIconUrl && image.src !== fallbackFileIconUrl) {
          image.className = "favorite-icon-image";
          image.src = fallbackFileIconUrl;
          return;
        }
        const fallbackFaviconUrl =
          customIconUrl && !isFileFavorite(favorite)
            ? favorite.iconUrl || getFaviconUrl(favorite.url ?? "")
            : "";
        if (fallbackFaviconUrl && image.src !== fallbackFaviconUrl) {
          image.className = "favorite-favicon";
          image.src = fallbackFaviconUrl;
          return;
        }
        const snapshotUrl = favorite.url
          ? getWebsiteSnapshotUrl(favorite.url)
          : "";
        if (snapshotUrl && image.src !== snapshotUrl) {
          image.className = "favorite-icon-image";
          image.src = snapshotUrl;
          return;
        }
        image.remove();
        if (isFileFavorite(favorite)) {
          icon.innerHTML = '<i class="fa-solid fa-file"></i>';
        } else {
          icon.textContent =
            favorite.name.trim().charAt(0).toUpperCase() || "?";
        }
      });
      icon.append(image);
    } else if (isFileFavorite(favorite)) {
      icon.innerHTML = '<i class="fa-solid fa-file"></i>';
    } else {
      icon.textContent = favorite.name.trim().charAt(0).toUpperCase() || "?";
    }

    const text = document.createElement("span");
    text.className = "favorite-text";
    const title = document.createElement("span");
    title.className = "favorite-name";
    title.textContent = favorite.name;
    const host = document.createElement("span");
    host.className = "favorite-host";
    host.textContent = isFileFavorite(favorite)
      ? "Local file"
      : getUrlHost(favorite.url ?? "");
    text.append(title, host);
    openButton.append(icon, text);

    const controls = document.createElement("span");
    controls.className = "favorite-controls";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "favorite-action";
    editButton.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editButton.setAttribute("aria-label", `Edit ${favorite.name}`);
    editButton.addEventListener("click", () => {
      setFavoriteEditMode(favorite);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "favorite-action";
    deleteButton.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteButton.setAttribute("aria-label", `Delete ${favorite.name}`);
    deleteButton.addEventListener("click", async () => {
      const confirmed = await safePrompt(
        `Are you sure you want to delete ${favorite.name}?`,
      );
      if (!confirmed) return;
      await updateFavoriteList((appConfig) => {
        appConfig.favorites = (appConfig.favorites ?? []).filter(
          (item) => String(item.id) !== String(favorite.id),
        );
      });
      if (String(editingFavoriteId) === String(favorite.id)) {
        setFavoriteEditMode();
      }
      await createFavoriteList();
      showNotification(`${favoriteLabels.singular} deleted`);
    });

    controls.append(editButton, deleteButton);
    li.append(openButton, controls);
    favoriteList.append(li);
  }

  applyButtonTooltips();
}

async function createGameList() {
  await migrateConfig();
  const config: AppConfig = await window.api.appConfig();
  const appDefaults: AppConfig = {
    games: games,
    favorites: favorites,
    favoriteColumnCount: 3,
    serverInfoEnabled: true,
    serverColumnCount: 1,
  };
  const defaults: ThemeConfig = {
    background: "",
    backgrounds: [],
    backgroundColor: "#0e1a23ff",
    textColor: "#88c0a9ff",
    accentColor: "#98e4f7ff",
    buttonColorAlpha: 0.65,
    buttonColor: "#14141e",
    buttonColorHoverAlpha: 0.95,
    buttonColorHover: "#28283c",
    baseTheme: "codex",
    particlesEnabled: true,
  };

  const appConfig: AppConfig = {
    ...appDefaults,
    ...(await window.api.localAppConfig()),
  };
  const themeConfig: ThemeConfig = {
    ...defaults,
    ...(await window.api.localThemeConfig()),
  };

  games = appConfig.games ?? [];
  favorites = appConfig.favorites ?? [];
  applyServerColumnCount(getServerColumnCount(appConfig));
  applyFavoriteColumnCount(getFavoriteColumnCount(appConfig));

  addStyle(config.customCSS ?? "");

  gameItemList.querySelectorAll("li").forEach((li) => li.remove());

  games.forEach(createGameItem);
  await createFavoriteList();
  setMainEditMode(mainEditModeEnabled);

  await applyRuntimeAppConfig(appConfig);
  applyThemeConfig(themeConfig);
  applyButtonTooltips();
}
// Load UI
await createGameList();

// Refreshes servers
refreshAllServerInfos();

// Sets ping interval from user config
setupPingInterval();
