// src/utils/appConfigHelpers.ts
import { AppConfigSchema } from "../schemas";
import { safePrompt } from "./safePrompt";
import {
  showNotification,
  setNotificationTimer,
} from "./notifications";
import { refreshAllServerInfos } from "./serverInfoHelpers";
import type { AppConfigurationForm } from "../components/AppConfigurationModal.vue";

let pingIntervalId: number | null = null;

/**
 * Fonction util appelée depuis Vue (App.vue)
 * Reprend l'ancienne logique du listener "#save-app-config" :
 * - validation Zod
 * - save config
 * - applyAppConfig
 * - refreshAllServerInfos
 * - setupPingInterval
 * - notifications
 */
export async function saveAppConfigFromForm(form: AppConfigurationForm) {
  // On récupère la config actuelle pour récupérer notamment les jeux déjà enregistrés
  const existing = await window.api.localAppConfig();

  const rawConfig: unknown = {
    // on garde les jeux existants
    games: existing.games ?? [],
    cachePath: form.cachePath || "",
    autoCacheClear: form.clearCacheOnClose,
    ignoreCertificateErrors: form.insecureSsl,
    discordRP: form.enableDiscordRp,
    notificationTimer: form.notificationTimer,
    serverInfoEnabled: form.enableServerStatus,
    serverInfoOptions: {
      statusEnabled: form.showServerStatusOnline,
      foundryVersionEnabled: form.showFoundryVersion,
      worldEnabled: form.showWorldName,
      gameSystemEnabled: form.showGameSystem,
      gameSystemVersionEnabled: form.showGameVersion,
      onlinePlayersEnabled: form.showOnlinePlayers,
    },
    serverInfoPingRate: form.serverInfosPingRate,
    fullScreenEnabled: form.forceFullScreen,
    shareSessionWindows: form.shareSessionBetweenWindows,
    // customCSS etc. restent comme dans existing si tu en as besoin
  };

  const result = AppConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    console.error(result.error.format());
    await safePrompt(
      "Invalid client values detected. Changes were not applied.",
      { mode: "alert" },
    );
    const appConfig = await window.api.localAppConfig();
    await applyRuntimeAppConfig(appConfig);
    return;
  }

  const validConfig = result.data as AppConfig;

  // Notification timer
  const timer =
    typeof validConfig.notificationTimer === "number"
      ? validConfig.notificationTimer
      : 3;
  setNotificationTimer(timer);

  // Fullscreen
  window.api.setFullScreen(validConfig.fullScreenEnabled ?? false);
  const closeButton = document.querySelector(
    ".tooltip-wrapper.close-app",
  ) as HTMLElement | null;
  if (closeButton) {
    const fs = await window.api.isFullScreen();
    closeButton.style.display = fs ? "block" : "none";
  }

  await window.api.saveAppConfig(validConfig);
  await applyRuntimeAppConfig(validConfig);
  refreshAllServerInfos();
  await setupPingInterval();

  showNotification("Changes saved");
}

export async function applyRuntimeAppConfig(config: AppConfig) {
  // Cache path
  if (typeof config.cachePath === "string") {
    window.api.setCachePath(config.cachePath);
  } else {
    window.api.setCachePath("");
  }

  // Notification timer
  const timer = typeof config.notificationTimer === "number" ? config.notificationTimer : 3;
  setNotificationTimer(timer);

  // Fullscreen
  const fsEnabled = !!config.fullScreenEnabled;
  window.api.setFullScreen(fsEnabled);

  const closeButton = document.querySelector(".tooltip-wrapper.close-app") as HTMLElement | null;
  if (closeButton) {
    const fs = await window.api.isFullScreen();
    closeButton.style.display = fs ? "block" : "none";
  }

  // Server refresh interval
  await setupPingInterval();

  // (Si tu veux refresh serveur immédiat quand on charge)
  // refreshAllServerInfos();
}

/**
 * Sets ping interval from user config
 */
export async function setupPingInterval() {
  // Read config and retrieve rate (or fallback to 30 000 ms)
  const cfg = await window.api.localAppConfig();
  const seconds = cfg.serverInfoPingRate;
  const rate = Math.max(1, seconds) * 1000;

  // If there was an interval running already, stop it
  if (pingIntervalId !== null) {
    clearInterval(pingIntervalId);
  }

  // Start a new interval
  pingIntervalId = window.setInterval(refreshAllServerInfos, rate);
}
