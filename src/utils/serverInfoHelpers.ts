// src/utils/serverInfoHelpers.ts
import type { GameConfig, ServerStatusData } from "../schemas";
import { getHostedServiceFromUrl } from "./hostedServiceNavigation";

const seenOffline = new Map<string, boolean>();

async function getServerInfo(
  game: GameConfig,
): Promise<ServerStatusData | null> {
  // plus de CORS, on passe par main.ts
  return window.api.pingServer(game.url, game.id ?? game.name);
}

function setWrapperDisplay(
  wrapper: HTMLElement | null,
  visible: boolean,
): void {
  if (wrapper) wrapper.style.display = visible ? "" : "none";
}

function setInfoText(span: HTMLElement, iconClass: string, text: string): void {
  const icon = document.createElement("i");
  icon.className = iconClass;
  span.replaceChildren(icon, document.createTextNode(` ${text}`));
}

function updateHostedServiceBadge(
  serverInfos: HTMLElement,
  hostedService: "forge" | "sqyre" | null,
  signedInUser?: string | null,
): void {
  const existingBadge = serverInfos.querySelector(
    ".hosted-service-wrapper",
  ) as HTMLElement | null;
  if (!hostedService) {
    existingBadge?.remove();
    return;
  }

  const serviceName = hostedService === "sqyre" ? "Sqyre" : "The Forge";
  const badge = existingBadge ?? document.createElement("div");
  badge.className = "tooltip-wrapper hosted-service-wrapper";
  badge.dataset.hostedService = hostedService;

  let label = badge.querySelector(".hosted-service") as HTMLElement | null;
  if (!label) {
    label = document.createElement("span");
    label.className = "hosted-service";
    badge.append(label);
  }
  if (!existingBadge || signedInUser !== undefined) {
    const badgeText = signedInUser
      ? `${serviceName} (${signedInUser})`
      : serviceName;
    setInfoText(label, "fa-solid fa-cloud", badgeText);
  }

  let tooltip = badge.querySelector(".tooltip") as HTMLElement | null;
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "tooltip";
    badge.append(tooltip);
  }
  if (!existingBadge || signedInUser !== undefined) {
    tooltip.textContent = signedInUser
      ? `Hosted by ${serviceName} · Signed in as ${signedInUser}`
      : `Hosted by ${serviceName}`;
  }
  if (!existingBadge) serverInfos.append(badge);
}

export async function updateServerInfos(item: HTMLElement, game: GameConfig) {
  // Retrieve user config
  const { serverInfoEnabled = true, serverInfoOptions } =
    await window.api.localAppConfig();

  const serverInfos = item.querySelector(
    ".server-infos",
  ) as HTMLDivElement | null;
  if (!serverInfos) return;

  const hostedService = getHostedServiceFromUrl(game.url ?? "");
  updateHostedServiceBadge(serverInfos, hostedService);

  // If global toggle is off, hide everything and return
  if (!serverInfoEnabled) {
    item.classList.remove("server-active");
    item.classList.remove("server-hosted");
    serverInfos.style.display = "none";
    return;
  }
  serverInfos.style.display = "";

  // Individual options and their defaults
  const {
    statusEnabled = true,
    foundryVersionEnabled = true,
    worldEnabled = false,
    gameSystemEnabled = true,
    gameSystemVersionEnabled = true,
    onlinePlayersEnabled = true,
  } = serverInfoOptions ?? {};

  // Retrieve each <span> and apply show/hide
  const statusSpan = serverInfos.querySelector(".status") as HTMLSpanElement;
  const versionSpan = serverInfos.querySelector(".version") as HTMLSpanElement;
  const worldSpan = serverInfos.querySelector(".world") as HTMLSpanElement;
  const systemSpan = serverInfos.querySelector(".system") as HTMLSpanElement;
  const systemVersionSpan = serverInfos.querySelector(
    ".systemVersion",
  ) as HTMLSpanElement;
  const usersSpan = serverInfos.querySelector(".users") as HTMLSpanElement;

  const statusWrapper = statusSpan.closest(".tooltip-wrapper") as HTMLElement;
  const versionWrapper = versionSpan.closest(".tooltip-wrapper") as HTMLElement;
  const worldWrapper = worldSpan.closest(".tooltip-wrapper") as HTMLElement;
  const systemWrapper = systemSpan.closest(".tooltip-wrapper") as HTMLElement;
  const systemVersionWrapper = systemVersionSpan.closest(
    ".tooltip-wrapper",
  ) as HTMLElement;
  const usersWrapper = usersSpan.closest(".tooltip-wrapper") as HTMLElement;
  const isSqyreGame = hostedService === "sqyre";
  const isHostedGame = hostedService !== null;

  if (game.serverInfoAutoRefreshDisabled) {
    item.classList.remove("server-active");
    setWrapperDisplay(statusWrapper, false);
    setWrapperDisplay(usersWrapper, false);
    setWrapperDisplay(versionWrapper, foundryVersionEnabled);
    setWrapperDisplay(worldWrapper, worldEnabled);
    setWrapperDisplay(systemWrapper, gameSystemEnabled);
    setWrapperDisplay(systemVersionWrapper, gameSystemVersionEnabled);

    if (foundryVersionEnabled) {
      versionSpan.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${
        game.cachedFoundryVersion ? `v${game.cachedFoundryVersion}` : "-"
      }`;
    }
    if (worldEnabled) {
      worldSpan.innerHTML = `<i class="fa-solid fa-globe"></i> -`;
    }
    if (gameSystemEnabled) {
      systemSpan.innerHTML = `<i class="fa-solid fa-dice"></i> ${
        game.cachedGameSystem?.toUpperCase() ?? "-"
      }`;
    }
    if (gameSystemVersionEnabled) {
      systemVersionSpan.innerHTML = `<i class="fa-solid fa-screwdriver-wrench"></i> ${game.cachedGameSystemVersion ?? "-"} <span class="server-refresh-disabled"><i class="fa-solid fa-ban"></i> Server refresh disabled</span>`;
    }
    return;
  }

  if (isSqyreGame) {
    const hasValue = (span: HTMLElement) =>
      !span.textContent?.includes("?") && !!span.textContent?.trim();

    if (statusEnabled && !hasValue(statusSpan)) {
      setInfoText(statusSpan, "fa-solid fa-spinner fa-spin", "Checking");
    }
    setWrapperDisplay(statusWrapper, statusEnabled);
    setWrapperDisplay(
      versionWrapper,
      foundryVersionEnabled && hasValue(versionSpan),
    );
    setWrapperDisplay(worldWrapper, worldEnabled && hasValue(worldSpan));
    setWrapperDisplay(
      systemWrapper,
      gameSystemEnabled && hasValue(systemSpan),
    );
    setWrapperDisplay(systemVersionWrapper, false);
    setWrapperDisplay(usersWrapper, false);
  } else {
    setWrapperDisplay(statusWrapper, statusEnabled);
    setWrapperDisplay(versionWrapper, foundryVersionEnabled);
    setWrapperDisplay(worldWrapper, worldEnabled);
    setWrapperDisplay(systemWrapper, gameSystemEnabled);
    setWrapperDisplay(
      systemVersionWrapper,
      !isSqyreGame && gameSystemVersionEnabled,
    );
    setWrapperDisplay(usersWrapper, onlinePlayersEnabled);
  }

  // Ping server
  let info: ServerStatusData | null = null;
  let errorReason: string | null = null;
  try {
    info = await getServerInfo(game);
  } catch (err: any) {
    errorReason = err?.message ?? String(err);
    info = null;
  }

  const idKey = String(game.id ?? game.name);

  if (info?.hostedService === "forge") {
    updateHostedServiceBadge(
      serverInfos,
      hostedService,
      info.signedInUser ?? null,
    );
  }

  if (
    info?.imageUrl &&
    (!item.classList.contains("has-server-background") ||
      !game.backgroundImageUrl)
  ) {
    item.style.setProperty(
      "--server-background-image",
      `url(${JSON.stringify(info.imageUrl)})`,
    );
    item.classList.add("has-server-background");
    item.classList.toggle(
      "server-background-placeholder",
      info.imageIsFallback ?? false,
    );
  }

  if (!info && isHostedGame) {
    seenOffline.set(idKey, false);
    item.classList.remove("server-active");
    item.classList.add("server-hosted");
    setWrapperDisplay(statusWrapper, statusEnabled);
    setWrapperDisplay(versionWrapper, false);
    setWrapperDisplay(worldWrapper, false);
    setWrapperDisplay(systemWrapper, false);
    setWrapperDisplay(systemVersionWrapper, false);
    setWrapperDisplay(usersWrapper, false);

    if (statusEnabled) {
      const isNotFound = /\bHTTP\s+404\b/i.test(errorReason ?? "");
      if (!isNotFound) {
        updateHostedServiceBadge(serverInfos, hostedService, null);
      }
      setInfoText(
        statusSpan,
        isNotFound ? "fa-solid fa-xmark" : "fa-solid fa-right-to-bracket",
        isNotFound ? "Unavailable" : "Sign In Required",
      );
      const statusTooltip = statusWrapper.querySelector(
        ".tooltip",
      ) as HTMLElement | null;
      if (statusTooltip) {
        const serviceName = hostedService === "sqyre" ? "Sqyre" : "The Forge";
        statusTooltip.textContent = isNotFound
          ? `${serviceName} game was not found`
          : `Open this game to sign in to ${serviceName}, then refresh its status`;
      }
    }
    return;
  }

  if (info?.hostedService === "sqyre") {
    seenOffline.set(idKey, false);
    item.classList.remove("server-active");
    item.classList.add("server-hosted");
    updateHostedServiceBadge(
      serverInfos,
      hostedService,
      info.signedInUser ?? null,
    );
    setWrapperDisplay(statusWrapper, statusEnabled);
    setWrapperDisplay(versionWrapper, foundryVersionEnabled && !!info.version);
    setWrapperDisplay(worldWrapper, worldEnabled && !!info.gameType);
    setWrapperDisplay(systemWrapper, gameSystemEnabled && !!info.system);
    setWrapperDisplay(systemVersionWrapper, false);
    setWrapperDisplay(usersWrapper, false);

    if (statusEnabled) {
      const hostedState =
        {
          initiated: ["fa-solid fa-spinner fa-spin", "Starting"],
          pending: ["fa-solid fa-spinner fa-spin", "Starting"],
          running: ["fa-solid fa-signal", "Online"],
          stopping: ["fa-solid fa-spinner fa-spin", "Stopping"],
          stopped: ["fa-solid fa-moon", "Sleeping"],
          failed: ["fa-solid fa-triangle-exclamation", "Server Error"],
          "in-service": ["fa-solid fa-arrows-rotate fa-spin", "Updating"],
          idle: ["fa-solid fa-moon", "Sleeping"],
          stored: ["fa-solid fa-box-archive", "Sleeping"],
        }[info.hostedStatus ?? ""] ?? [
          "fa-solid fa-circle-question",
          "Status Unknown",
        ];
      setInfoText(
        statusSpan,
        hostedState[0],
        hostedState[1],
      );
      const statusTooltip = statusWrapper.querySelector(
        ".tooltip",
      ) as HTMLElement | null;
      if (statusTooltip) {
        statusTooltip.textContent = info.createdBy
          ? `Sqyre server status · Created by ${info.createdBy}`
          : "Sqyre server status";
      }
    }
    if (foundryVersionEnabled && info.version) {
      setInfoText(versionSpan, "fa-solid fa-dice-d20", `v${info.version}`);
    }
    if (worldEnabled && info.gameType) {
      setInfoText(worldSpan, "fa-solid fa-book-open", info.gameType);
      const gameTypeTooltip = worldWrapper.querySelector(
        ".tooltip",
      ) as HTMLElement | null;
      if (gameTypeTooltip) gameTypeTooltip.textContent = "Game Type";
    }
    if (gameSystemEnabled && info.system) {
      const systemLabel = /^Dungeons & Dragons Fifth Edition$/i.test(
        info.system,
      )
        ? "DND5E"
        : info.system;
      setInfoText(systemSpan, "fa-solid fa-dice", systemLabel);
      const gameSystemTooltip = systemWrapper.querySelector(
        ".tooltip",
      ) as HTMLElement | null;
      if (gameSystemTooltip) {
        gameSystemTooltip.textContent = `Game System: ${info.system}`;
      }
    }
    return;
  }

  const wasOffline = seenOffline.get(idKey) ?? false;
  const nowOffline = info === null;

  if (nowOffline && !wasOffline) {
    console.warn(
      `Server ${game.name} is unreachable.` +
        (errorReason ? ` Reason: ${errorReason}` : ""),
    );
  }
  if (!nowOffline && wasOffline) {
    console.info(`Server ${game.name} is back online.`);
  }
  seenOffline.set(idKey, nowOffline);

  // If it fails, displays "-"
  if (!info) {
    item.classList.remove("server-active");
    item.classList.remove("server-hosted");
    if (statusEnabled) {
      statusSpan.innerHTML = `<i class="fa-solid fa-xmark"></i> Offline`;
    }
    if (foundryVersionEnabled) {
      versionSpan.innerHTML = `<i class="fa-solid fa-dice-d20"></i> -`;
    }
    if (worldEnabled) {
      worldSpan.innerHTML = `<i class="fa-solid fa-globe"></i> -`;
    }
    if (gameSystemEnabled) {
      systemSpan.innerHTML = `<i class="fa-solid fa-dice"></i> -`;
    }
    if (!isSqyreGame && gameSystemVersionEnabled) {
      systemVersionSpan.innerHTML = `<i class="fa-solid fa-screwdriver-wrench"></i> -`;
    }
    if (onlinePlayersEnabled) {
      usersSpan.innerHTML = `<i class="fa-solid fa-users"></i> -`;
    }
    return;
  }

  const parsedUsers = Number(info.users);
  const activeUsers = Number.isFinite(parsedUsers) ? parsedUsers : 0;
  const hasActivePlayers = activeUsers > 0;
  item.classList.toggle("server-hosted", hostedService !== null);
  item.classList.toggle("server-active", hasActivePlayers);

  // Otherwise, inject real data
  if (statusEnabled) {
    statusSpan.innerHTML = info.version
      ? `<i class="fa-solid fa-signal"></i> Online`
      : `<i class="fa-solid fa-xmark"></i> Offline`;
  }
  if (foundryVersionEnabled) {
    versionSpan.innerHTML = `<i class="fa-solid fa-dice-d20"></i> v${info.version ?? "-"}`;
  }
  if (worldEnabled) {
    worldSpan.innerHTML = `<i class="fa-solid fa-globe"></i> ${info.world ?? "-"}`;
  }
  if (gameSystemEnabled) {
    systemSpan.innerHTML = `<i class="fa-solid fa-dice"></i> ${info.system?.toUpperCase() ?? "-"}`;
  }
  if (gameSystemVersionEnabled) {
    systemVersionSpan.innerHTML = `<i class="fa-solid fa-screwdriver-wrench"></i> ${info.systemVersion ?? "-"}`;
  }
  if (onlinePlayersEnabled) {
    usersSpan.innerHTML = `<i class="fa-solid fa-users"></i> ${
      hasActivePlayers ? `${activeUsers} Online` : activeUsers
    }`;
  }
}

export async function refreshAllServerInfos() {
  // On relit la config pour obtenir la liste des jeux à jour
  const { games = [] } = await window.api.localAppConfig();

  const gameItems = Array.from(
    document.querySelectorAll<HTMLElement>(".game-item"),
  );

  await Promise.all(
    gameItems.map(async (item) => {
      const key = item.dataset.gameId!;
      const game = games.find(
        (g) => String(g.id) === key || String(g.name) === key,
      );
      if (!game) return;
      if (game.serverInfoAutoRefreshDisabled) return;

      try {
        await updateServerInfos(item, game);
      } catch (err) {
        console.warn(`updateServerInfos failed for ${game.name}:`, err);
      }
    }),
  );
}
