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
import { extractImportedLoginRecords } from "./utils/importLoginRecords";
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
let draggedGameItem: HTMLElement | null = null;
let draggedFavoriteItem: HTMLElement | null = null;
let mainEditModeEnabled = false;

const mainEditModeToggle = document.querySelector(
  "#toggle-main-edit-mode",
) as HTMLButtonElement;

function toCssUrl(url: string) {
  return `url("${url.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
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
  window.api.saveAppConfig(appConfig);
}

async function updateFavoriteList(task: (appConfig: AppConfig) => void) {
  const appConfig = await window.api.localAppConfig();
  appConfig.favorites = appConfig.favorites ?? [];
  task(appConfig);
  favorites = appConfig.favorites ?? [];
  window.api.saveAppConfig(appConfig);
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
favoriteEmptyState.textContent = `Add your first ${favoriteLabels.singular.toLowerCase()} website.`;

function getGameKey(game: GameConfig): string {
  return String(game.id ?? game.name);
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

function getUrlHost(url: string) {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(
      parsed.origin,
    )}&sz=64`;
  } catch {
    return "";
  }
}

function setFavoriteEditMode(favorite?: FavoriteConfig) {
  editingFavoriteId = favorite?.id ?? null;
  favoriteNameField.value = favorite?.name ?? "";
  favoriteUrlField.value = favorite?.url ?? "";
  addFavoriteButton.textContent = favorite
    ? `Save ${favoriteLabels.singular}`
    : `Add ${favoriteLabels.singular}`;
  cancelFavoriteEditButton.classList.toggle("hidden-display", !favorite);
}

addFavoriteButton.addEventListener("click", async () => {
  const favoriteName = favoriteNameField.value.trim();
  const favoriteUrl = normalizeFavoriteUrl(favoriteUrlField.value);
  if (!favoriteName || !favoriteUrl) {
    await safePrompt(
      `Please enter a ${favoriteLabels.singular} name and URL.`,
      {
        mode: "alert",
      },
    );
    return;
  }

  try {
    new URL(favoriteUrl);
  } catch {
    await safePrompt("Please enter a valid website URL.", { mode: "alert" });
    return;
  }

  if (editingFavoriteId !== null) {
    await updateFavoriteList((appConfig) => {
      const favorite = appConfig.favorites?.find(
        (item) => String(item.id) === String(editingFavoriteId),
      );
      if (favorite) {
        favorite.name = favoriteName;
        favorite.url = favoriteUrl;
        favorite.iconUrl = getFaviconUrl(favoriteUrl);
      }
    });
    showNotification(`${favoriteLabels.singular} saved`);
  } else {
    const newFavorite: FavoriteConfig = {
      id: Math.round(Math.random() * 1000000),
      name: favoriteName,
      url: favoriteUrl,
      iconUrl: getFaviconUrl(favoriteUrl),
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
  mainEditModeToggle.title = enabled
    ? "Switch to Play Mode"
    : "Switch to Edit Mode";
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
    document
      .querySelectorAll<HTMLElement>(".user-configuration")
      .forEach((config) => config.classList.add("hidden"));
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
    const themeSelector = document.querySelector(
      "#theme-selector",
    ) as HTMLSelectElement;
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
    const selectedBase = themeSelector?.value || existingConfig.baseTheme;
    const config = {
      baseTheme: selectedBase,
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
  const themeSelector = document.getElementById(
    "theme-selector",
  ) as HTMLSelectElement;

  if (!themeStylesheet || !themeSelector) {
    console.error("Theme selector or stylesheet not found.");
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
  if (themeConfig.fontPrimary === "__custom") {
    primaryCustomField.style.display = "flex";
  } else if (themeConfig.fontPrimary === "__file") {
    primaryImportField.style.display = "block";
  }
  primaryFontSelect.addEventListener("change", () => {
    if (primaryFontSelect.value === "__custom") {
      primaryCustomField.style.display = "flex";
      primaryImportField.style.display = "none";
    } else if (primaryFontSelect.value === "__file") {
      primaryCustomField.style.display = "none";
      primaryImportField.style.display = "block";
    } else {
      primaryCustomField.style.display = "none";
      primaryImportField.style.display = "none";
    }
  });

  const secondaryFontSelect = document.querySelector<HTMLSelectElement>(
    "#secondary-font-selector",
  )!;
  const secondaryCustomField = document.getElementById(
    "secondary-custom-font",
  )!;
  const secondaryImportField = document.getElementById(
    "secondary-import-font",
  )!;

  if (themeConfig.fontSecondary === "__custom") {
    secondaryCustomField.style.display = "flex";
  } else if (themeConfig.fontSecondary === "__file") {
    secondaryImportField.style.display = "block";
  }
  secondaryFontSelect.addEventListener("change", () => {
    if (secondaryFontSelect.value === "__custom") {
      secondaryCustomField.style.display = "flex";
      secondaryImportField.style.display = "none";
    } else if (secondaryFontSelect.value === "__file") {
      secondaryCustomField.style.display = "none";
      secondaryImportField.style.display = "block";
    } else {
      secondaryCustomField.style.display = "none";
      secondaryImportField.style.display = "none";
    }
  });

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

  const particlesConfig =
    document.querySelector<HTMLElement>(".particles-config")!;
  const particlesCheckbox =
    document.querySelector<HTMLInputElement>("#particles-button")!;
  if (themeConfig.particlesEnabled == true) {
    particlesConfig.style.display = "block";
  }
  particlesCheckbox.addEventListener("change", () => {
    if (particlesCheckbox.checked == true) {
      particlesConfig.style.display = "block";
    } else {
      particlesConfig.style.display = "none";
    }
  });

  const selectedTheme = themeConfig.baseTheme ?? "codex";
  themeStylesheet.setAttribute("href", `styles/${selectedTheme}.css`);
  updaterStylesheet.setAttribute(
    "href",
    `styles/UpdaterModal-${selectedTheme}.css`,
  );
  appConfigStylesheet.setAttribute(
    "href",
    `styles/AppConfigurationModal-${selectedTheme}.css`,
  );
  themeSelector.value = selectedTheme;

  themeSelector.addEventListener("change", async () => {
    const newTheme = themeSelector.value;
    themeStylesheet.setAttribute("href", `styles/${newTheme}.css`);
    updaterStylesheet.setAttribute(
      "href",
      `styles/UpdaterModal-${newTheme}.css`,
    );
    appConfigStylesheet.setAttribute(
      "href",
      `styles/AppConfigurationModal-${newTheme}.css`,
    );
    const themeConfigMenu = document.querySelector(
      ".theme-configuration",
    ) as HTMLDivElement;
    if (themeConfigMenu) {
      themeConfigMenu.classList.add("flex-display");
      themeConfigMenu.classList.remove("hidden2");
      themeConfigMenu.classList.remove("hidden-display");
      themeConfigMenu.classList.add("show");
    }

    themeConfig.baseTheme = newTheme;
    preventMenuClose = true;
    await window.api.saveThemeConfig(themeConfig);
    showNotification("Theme changed");
    preventMenuClose = false;
  });

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

  function toggleConfigureGame(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const gameItem = target.closest(".game-item") as HTMLDivElement;
    if (!gameItem) return;

    const userConfig = gameItem.querySelector(
      ".user-configuration",
    ) as HTMLDivElement;
    if (!userConfig) return;

    const allUserConfigs = document.querySelectorAll(".user-configuration");

    allUserConfigs.forEach((config) => {
      if (config !== userConfig) {
        config.classList.add("hidden");
      }
    });

    if (userConfig.classList.contains("hidden")) {
      userConfig.classList.remove("hidden");
      userConfig.style.height = "0px"; // Start collapsed but visible

      requestAnimationFrame(() => {
        const scrollHeight = userConfig.scrollHeight;
        userConfig.style.height = `${scrollHeight + 15}px`; // Animate expansion
      });
    } else {
      userConfig.style.height = "0px"; // Collapse
      userConfig.addEventListener("transitionend", function handler(e) {
        if (e.propertyName === "height") {
          userConfig.classList.add("hidden");
          userConfig.removeEventListener("transitionend", handler);
        }
      });
    }
  }

  document.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement).closest(
      ".config-main-button.config",
    ) as HTMLButtonElement | null;
    if (target) {
      toggleConfigureGame(event as MouseEvent);
    }
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
    const game = games.find((g) => String(g.id) === key);
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
    });
  });
  document.getElementById("close-share")?.addEventListener("click", () => {
    (document.getElementById("share-input")! as HTMLTextAreaElement).value = "";
    (document.getElementById("share-output")! as HTMLElement).textContent = "";
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
    .getElementById("export-theme")!
    .addEventListener("click", exportTheme);
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
async function exportSettings() {
  const app = await window.api.localAppConfig();
  const rawTheme = await window.api.localThemeConfig();
  // Clean with Zod in order to apply defaults
  const parsed = ThemeConfigSchema.parse(rawTheme);
  const cleanTheme = { ...parsed };
  delete cleanTheme.fontPrimaryName;
  delete cleanTheme.fontPrimaryFilePath;
  delete cleanTheme.fontSecondaryName;
  delete cleanTheme.fontSecondaryFilePath;
  const full = { clientVersion: appVersion, app, theme: cleanTheme };
  document.getElementById("share-output")!.textContent = JSON.stringify(
    full,
    null,
    2,
  );
}

// Export Theme
async function exportTheme() {
  const rawTheme = await window.api.localThemeConfig();
  // Clean with Zod in order to apply defaults
  const parsed = ThemeConfigSchema.parse(rawTheme);

  const cleanTheme = { ...parsed };
  delete cleanTheme.fontPrimaryName;
  delete cleanTheme.fontPrimaryFilePath;
  delete cleanTheme.fontSecondaryName;
  delete cleanTheme.fontSecondaryFilePath;
  document.getElementById("share-output")!.textContent = JSON.stringify(
    {
      clientVersion: appVersion,
      theme: cleanTheme,
    },
    null,
    2,
  );
}

// Apply import
async function applyShareImport() {
  const themeStylesheet = document.getElementById(
    "theme-stylesheet",
  ) as HTMLLinkElement;
  const updaterStylesheet = document.getElementById(
    "updater-stylesheet",
  ) as HTMLLinkElement;
  const appConfigStylesheet = document.getElementById(
    "client-settings-stylesheet",
  ) as HTMLLinkElement;
  const txt = (document.getElementById("share-input") as HTMLTextAreaElement)
    .value;
  let data: any;
  try {
    data = JSON.parse(txt);
  } catch {
    await safePrompt("Invalid JSON data.", { mode: "alert" });
    return;
  }

  // full settings import
  if (data.app && data.theme && typeof data.app === "object") {
    const mergedApp = await mergeAppData(data.app);
    const mergedTheme = await mergeThemeData(data.theme);
    await window.api.saveAppConfig(mergedApp);
    window.api.saveLoginRecords(
      extractImportedLoginRecords(data, mergedApp.games ?? []),
    );
    await window.api.saveThemeConfig(mergedTheme);
    await applyRuntimeAppConfig(mergedApp);
    applyThemeConfig(mergedTheme);
    themeStylesheet.href = `styles/${mergedTheme.baseTheme}.css`;
    updaterStylesheet.setAttribute(
      "href",
      `styles/UpdaterModal-${mergedTheme.baseTheme}.css`,
    );
    appConfigStylesheet.setAttribute(
      "href",
      `styles/AppConfigurationModal-${mergedTheme.baseTheme}.css`,
    );
    await createGameList();
    return showNotification("Settings and login details imported");
  }

  // theme-only import
  if (
    typeof data.backgroundColor !== "undefined" &&
    typeof data.textColor !== "undefined" &&
    typeof data.accentColor !== "undefined"
  ) {
    const mergedTheme = await mergeThemeData(data);
    await window.api.saveThemeConfig(mergedTheme);
    applyThemeConfig(mergedTheme);
    themeStylesheet.href = `styles/${mergedTheme.baseTheme}.css`;
    updaterStylesheet.setAttribute(
      "href",
      `styles/UpdaterModal-${mergedTheme.baseTheme}.css`,
    );
    appConfigStylesheet.setAttribute(
      "href",
      `styles/AppConfigurationModal-${mergedTheme.baseTheme}.css`,
    );
    return showNotification("Theme imported");
  }

  await safePrompt("Could not recognise text format.", { mode: "alert" });
}

async function importFromFile() {
  const themeStylesheet = document.getElementById(
    "theme-stylesheet",
  ) as HTMLLinkElement;
  const updaterStylesheet = document.getElementById(
    "updater-stylesheet",
  ) as HTMLLinkElement;
  const appConfigStylesheet = document.getElementById(
    "client-settings-stylesheet",
  ) as HTMLLinkElement;
  const fileInput = document.getElementById("import-file") as HTMLInputElement;
  fileInput.onchange = async () => {
    const file = fileInput.files![0];
    const txt = await file.text();
    let data: any;
    try {
      data = JSON.parse(txt);
    } catch {
      await safePrompt("Invalid JSON data.", { mode: "alert" });
      return;
    }

    // full settings import
    if (data.app && data.theme && typeof data.app === "object") {
      const mergedApp = await mergeAppData(data.app);
      const mergedTheme = await mergeThemeData(data.theme);
      await window.api.saveAppConfig(mergedApp);
      window.api.saveLoginRecords(
        extractImportedLoginRecords(data, mergedApp.games ?? []),
      );
      await window.api.saveThemeConfig(mergedTheme);
      await applyRuntimeAppConfig(mergedApp);
      applyThemeConfig(mergedTheme);
      themeStylesheet.href = `styles/${mergedTheme.baseTheme}.css`;
      updaterStylesheet.setAttribute(
        "href",
        `styles/UpdaterModal-${mergedTheme.baseTheme}.css`,
      );
      appConfigStylesheet.setAttribute(
        "href",
        `styles/AppConfigurationModal-${mergedTheme.baseTheme}.css`,
      );
      await createGameList();
      return showNotification("Settings and login details imported");
    }

    // theme-only import
    if (
      typeof data.backgroundColor !== "undefined" &&
      typeof data.textColor !== "undefined" &&
      typeof data.accentColor !== "undefined"
    ) {
      const mergedTheme = await mergeThemeData(data);
      await window.api.saveThemeConfig(mergedTheme);
      applyThemeConfig(mergedTheme);
      themeStylesheet.href = `styles/${mergedTheme.baseTheme}.css`;
      updaterStylesheet.setAttribute(
        "href",
        `styles/UpdaterModal-${mergedTheme.baseTheme}.css`,
      );
      appConfigStylesheet.setAttribute(
        "href",
        `styles/AppConfigurationModal-${mergedTheme.baseTheme}.css`,
      );
      return showNotification("Theme imported");
    }

    await safePrompt("Could not recognise file format.", { mode: "alert" });
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
  const loginData = (await window.api.userData(
    game.id ?? game.name,
  )) as GameUserDataDecrypted;

  li.id = game.cssId;
  li.setAttribute("data-game-id", getGameKey(game));
  (li.querySelector(".user-name") as HTMLInputElement).value = loginData.user;
  (li.querySelector(".user-password") as HTMLInputElement).value =
    loginData.password;
  (li.querySelector(".admin-password") as HTMLInputElement).value =
    loginData.adminPassword;
  (li.querySelector(".game-name-edit") as HTMLInputElement).value = game.name;
  (li.querySelector(".game-url-edit") as HTMLInputElement).value = game.url;
  (
    li.querySelector(".server-auto-refresh-disabled") as HTMLInputElement
  ).checked = game.serverInfoAutoRefreshDisabled ?? false;
  (li.querySelector(".server-auto-login-enabled") as HTMLInputElement).checked =
    game.autoLoginEnabled ?? true;
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
  const userConfiguration = li.querySelector(
    "div.user-configuration",
  ) as HTMLDivElement;

  userConfiguration
    .querySelector(".delete-game")
    ?.addEventListener("click", async () => {
      const confirmed = await safePrompt(
        "Are you sure you want to delete this game?",
      );
      if (!confirmed) return;
      await updateGameList((appConfig) => {
        appConfig.games = appConfig.games.filter((g) => g.id !== game.id);
      });
      await createGameList();
      showNotification("Game deleted");
    });
  const gameId = game.id ?? game.name;
  const saveButton = userConfiguration.querySelector(
    ".save-user-data",
  ) as HTMLButtonElement;
  saveButton.addEventListener("click", async (e) => {
    if (!(e.target instanceof Element)) return;
    e.target.closest(".user-configuration").classList.add("hidden");
    const closeUserConfig = e.target.closest(
      ".user-configuration",
    ) as HTMLDivElement;
    const user = (
      closeUserConfig.querySelector(".user-name") as HTMLInputElement
    ).value;
    const password = (
      closeUserConfig.querySelector(".user-password") as HTMLInputElement
    ).value;
    const adminPassword = (
      closeUserConfig.querySelector(".admin-password") as HTMLInputElement
    ).value;
    const newGameName = (
      closeUserConfig.querySelector(".game-name-edit") as HTMLInputElement
    ).value;
    const newGameUrl = (
      closeUserConfig.querySelector(".game-url-edit") as HTMLInputElement
    ).value;
    const serverInfoAutoRefreshDisabled = (
      closeUserConfig.querySelector(
        ".server-auto-refresh-disabled",
      ) as HTMLInputElement
    ).checked;
    const autoLoginEnabled = (
      closeUserConfig.querySelector(
        ".server-auto-login-enabled",
      ) as HTMLInputElement
    ).checked;

    console.log({
      gameId,
      user,
      password,
      adminPassword,
      newGameName,
      newGameUrl,
      serverInfoAutoRefreshDisabled,
      autoLoginEnabled,
    });

    game.name = newGameName;
    game.url = newGameUrl;
    game.serverInfoAutoRefreshDisabled = serverInfoAutoRefreshDisabled;
    game.autoLoginEnabled = autoLoginEnabled;

    (li.querySelector("a") as HTMLAnchorElement).innerText = newGameName;
    li.setAttribute("data-game-id", getGameKey(game));

    await updateGameList((appConfig) => {
      const gameToUpdate = appConfig.games.find((g) => g.id === game.id);
      if (gameToUpdate) {
        gameToUpdate.name = newGameName;
        gameToUpdate.url = newGameUrl;
        gameToUpdate.serverInfoAutoRefreshDisabled =
          serverInfoAutoRefreshDisabled;
        gameToUpdate.autoLoginEnabled = autoLoginEnabled;
      }
    });
    await refreshServerButtonBackground(li, game, { force: true });

    window.api.saveUserData({
      gameId,
      user,
      password,
      adminPassword,
    } as SaveUserData);
    showNotification("Game settings saved");
  });
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

  const particlesConfig = (document.querySelector(
    ".particles-config",
  ) as HTMLElement)!;
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
  primaryImportField.style.display =
    primaryFontSelect.value === "__file" ? "block" : "none";
  customSecondaryField.style.display =
    secondaryFontSelect.value === "__custom" ? "flex" : "none";
  secondaryImportField.style.display =
    secondaryFontSelect.value === "__file" ? "block" : "none";

  particlesConfig.style.display = particlesCheckboxEnabled ? "block" : "none";

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
  window.api.saveAppConfig(localAppConfig);
}

function renderTooltips() {
  const layer = document.getElementById("tooltip-layer");
  if (!layer) return;

  document.querySelectorAll(".tooltip-wrapper").forEach((wrapper) => {
    const tooltip = wrapper.querySelector<HTMLElement>(".tooltip");
    if (!tooltip) return;

    // tries to find an input of type range
    const input = wrapper.querySelector<HTMLInputElement>("input[type=range]");

    wrapper.addEventListener("mouseenter", () => {
      const rect = wrapper.getBoundingClientRect();
      const clone = tooltip.cloneNode(true) as HTMLElement;
      clone.classList.add("active-tooltip");
      clone.style.display = "block";
      clone.style.position = "fixed";
      clone.style.pointerEvents = "none";
      clone.style.transform = "translateX(-50%)";
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
    const label =
      wrapperTooltip ||
      button.getAttribute("aria-label") ||
      button.textContent?.trim();

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
      url.textContent = favorite.url;
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
      window.api.openDefaultBrowser(favorite.url);
    });

    const icon = document.createElement("span");
    icon.className = "favorite-icon";
    const iconUrl = getFaviconUrl(favorite.url) || favorite.iconUrl;
    if (iconUrl) {
      const image = document.createElement("img");
      image.src = iconUrl;
      image.alt = "";
      image.addEventListener("error", () => {
        image.remove();
        icon.textContent = favorite.name.trim().charAt(0).toUpperCase() || "?";
      });
      icon.append(image);
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
    host.textContent = getUrlHost(favorite.url);
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
    baseTheme: undefined,
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
