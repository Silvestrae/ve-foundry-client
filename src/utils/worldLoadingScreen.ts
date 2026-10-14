export interface WorldLoadingScreenOptions {
  worldName: string;
  iconUrl: string;
  backgroundColor: string;
  accentColor: string;
  textColor: string;
  lastLoadMs?: number | null;
  initialElapsedMs?: number;
}

export const worldLoadingCheckpoints = [
  { label: "Loading Foundry and modules", hook: "init" },
  { label: "Reading settings and translations", hook: "i18nInit" },
  { label: "Preparing world documents", hook: "setup" },
  { label: "Configuring the scene renderer", hook: "canvasConfig" },
  { label: "Preparing the current scene", hook: "canvasInit" },
  { label: "Loading scene assets", hook: "canvasDraw" },
  { label: "Drawing the scene and layers", hook: "canvasReady" },
  { label: "Finishing startup", hook: null as string | null },
] as const;

// Polling can begin before Foundry exposes Hooks. Install once when it becomes
// available, and keep game.ready as the fallback for all supported versions.
export const worldLoadingProgressScript = `(() => {
  const state = globalThis.__veClientWorldLoading ??= { stage: 0, hooksInstalled: false };
  if (!state.hooksInstalled && typeof globalThis.Hooks?.once === "function") {
    state.hooksInstalled = true;
    const hooks = ${JSON.stringify(worldLoadingCheckpoints.map((checkpoint) => checkpoint.hook).filter(Boolean))};
    hooks.forEach((hook, index) => {
      globalThis.Hooks.once(hook, () => { state.stage = Math.max(state.stage, index + 1); });
    });
  }
  const game = globalThis.game;
  const skipScene = (state.stage >= 3 || game?.ready) && (
    game?.settings?.get?.("core", "noCanvas") === true ||
    (game?.scenes && !game.scenes.current && !game.scenes.active)
  );
  return { stage: skipScene ? 7 : state.stage, skipScene: Boolean(skipScene), ready: Boolean(game?.ready) };
})()`;

export function createWorldLoadingHtml(options: WorldLoadingScreenOptions) {
  const settings = JSON.stringify(options).replace(/</g, "\\u003c");
  const color = (value: string, fallback: string) =>
    /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value) ? value : fallback;
  // A very low-opacity, single-pixel texture breaks up 8-bit colour bands.
  // It is static and sits behind the content, rather than adding visible grain.
  const dither =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.95" numOctaves="1" seed="17" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
    );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      --background: ${color(options.backgroundColor, "#0e1a23")};
      --accent: ${color(options.accentColor, "#98e4f7")};
      --text: ${color(options.textColor, "#88c0a9")};
      --panel: color-mix(in srgb, var(--background) 92%, var(--text));
      --border: color-mix(in srgb, var(--text) 23%, var(--background));
      --muted: color-mix(in srgb, var(--text) 75%, var(--background));
      font: 400 16px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--background);
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    #ve-world-loading-banner {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: safe center;
      padding: 24px;
      overflow: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--border) transparent;
      isolation: isolate;
      background: var(--background);
      background-image: radial-gradient(ellipse 80% 85% at 50% 8% in oklab,
        color-mix(in oklab, var(--background) 88%, var(--accent)) 0%,
        color-mix(in oklab, var(--background) 92%, var(--accent)) 26%,
        color-mix(in oklab, var(--background) 97%, var(--accent)) 58%,
        var(--background) 100%);
      opacity: 1;
      transition: opacity 300ms ease;
    }
    #ve-world-loading-banner.ve-world-loading-banner-hidden { opacity: 0; }
    #ve-world-loading-banner::before { content: ""; position: fixed; inset: 0; z-index: -1; background-image: url("${dither}"); background-size: 192px 192px; opacity: .018; pointer-events: none; }
    .content { display: grid; justify-items: center; width: min(100%, 420px); }
    .icon {
      display: block;
      width: min(156px, 20vh);
      height: min(156px, 20vh);
      margin-bottom: 18px;
      object-fit: contain;
      animation: glow 2.8s ease-in-out infinite;
    }
    h1 { margin: 0 0 7px; font-size: clamp(21px, 3vw, 26px); font-weight: 700; line-height: 1.2; text-align: center; }
    .ellipsis { display: inline-flex; width: .9em; margin-left: .08em; }
    .ellipsis span { opacity: .2; animation: dot 1.2s steps(1, end) infinite; }
    .ellipsis span:nth-child(2) { animation-delay: .2s; }
    .ellipsis span:nth-child(3) { animation-delay: .4s; }
    .world { max-width: 100%; margin: 0 0 18px; color: var(--muted); font-size: 14px; text-align: center; overflow-wrap: anywhere; }
    .activity { width: 100%; padding: 18px 20px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); }
    .checkpoints {
      position: relative;
      height: 170px;
      margin: 0;
      padding: 0;
      overflow: hidden;
      list-style: none;
      mask-image: linear-gradient(transparent, black 8%, black 92%, transparent);
    }
    .checkpoints::before {
      content: "";
      position: absolute;
      inset: 40% 0 auto;
      height: 20%;
      border-block: 1px solid color-mix(in srgb, var(--accent) 10%, transparent);
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 5%, transparent), transparent);
    }
    .checkpoints li {
      position: absolute;
      top: 50%;
      left: 50%;
      width: min(var(--checkpoint-group-width, 100%), calc(100% - 20px));
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      height: 20%;
      color: var(--muted);
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      transition: transform 400ms cubic-bezier(.22, .61, .36, 1), opacity 320ms ease, color 320ms ease;
      will-change: transform, opacity;
    }
    .checkpoints [data-position="current"] { color: var(--accent); font-weight: 750; }
    .step-number { display: grid; place-items: center; flex: 0 0 28px; font-variant-numeric: tabular-nums; }
    [data-state="current"] .step-number::after {
      content: "";
      width: 18px;
      height: 18px;
      border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    .step-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .loading-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .detail { margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--border); text-align: center; }
    .item { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }
    .timing { display: flex; justify-content: center; flex-wrap: wrap; gap: 5px 14px; margin-top: 9px; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .message { margin: 16px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; text-align: center; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes glow { 0%, 100% { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--accent) 18%, transparent)); } 50% { filter: drop-shadow(0 0 20px color-mix(in srgb, var(--accent) 36%, transparent)); } }
    @keyframes dot { 0%, 19%, 100% { opacity: .2; } 20%, 99% { opacity: 1; } }
    @media (max-height: 540px) {
      #ve-world-loading-banner { padding: 16px; }
      .icon { width: 84px; height: 84px; margin-bottom: 10px; }
      .world { margin-bottom: 12px; }
      .activity { padding: 14px 18px; }
      .checkpoints { height: 150px; }
      .detail { margin-top: 12px; padding-top: 10px; }
      .message { margin-top: 10px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::after { animation: none !important; transition: none !important; }
      .ellipsis span { opacity: 1; }
    }
    @media (max-height: 420px) {
      .icon { width: 48px; height: 48px; margin-bottom: 8px; }
      h1 { font-size: 21px; }
      .world { margin-bottom: 10px; }
      .checkpoints { height: 120px; }
      .message { display: none; }
    }
    @media (max-width: 480px) {
      .checkpoints li { gap: 8px; font-size: 13px; }
    }
  </style>
</head>
<body>
  <section id="ve-world-loading-banner" role="status" aria-live="polite" aria-label="Loading your Foundry world">
    <div class="content">
      <img class="icon" alt="VE Desktop" draggable="false">
      <h1>Loading your game<span class="ellipsis" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></h1>
      <p class="world" data-loading-heading></p>
      <section class="activity" aria-label="Loading progress">
        <ol class="checkpoints" aria-label="Loading checkpoints" aria-live="off">
          ${worldLoadingCheckpoints.map((checkpoint, index) => `<li><span class="step-number">${index + 1}/${worldLoadingCheckpoints.length}</span><span class="step-label">${checkpoint.label}</span></li>`).join("\n")}
        </ol>
        <p class="loading-announcement" data-loading-announcement aria-live="polite" aria-atomic="true"></p>
        <div class="detail" aria-live="off">
          <span class="item" data-loading-item>Initialising Foundry...</span>
          <div class="timing"><span data-loading-elapsed>Elapsed · 0:00</span><span data-loading-previous>Last load time · —</span></div>
        </div>
      </section>
      <p class="message" data-loading-message>This screen will close automatically when your world is ready.</p>
    </div>
  </section>
  <script>
    (() => {
      const settings = ${settings};
      const banner = document.getElementById("ve-world-loading-banner");
      const rows = Array.from(banner.querySelectorAll(".checkpoints li"));
      const labels = rows.map(row => row.querySelector(".step-label").textContent);
      const measureContext = document.createElement("canvas").getContext("2d");
      banner.querySelector(".icon").src = settings.iconUrl;
      banner.querySelector("[data-loading-heading]").textContent = settings.worldName;
      let stage = 0;
      let skipScene = false;
      let finished = false;
      const startedAt = performance.now() - Math.max(0, Number(settings.initialElapsedMs) || 0);
      const timers = [];
      const formatDuration = (ms) => {
        if (ms < 1000) return Math.round(ms) + " ms";
        if (ms < 60000) return (ms / 1000).toFixed(1) + " s";
        const seconds = Math.floor(ms / 1000);
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      };
      if (typeof settings.lastLoadMs === "number" && Number.isFinite(settings.lastLoadMs) && settings.lastLoadMs >= 0) {
        banner.querySelector("[data-loading-previous]").textContent = "Last load time · " + formatDuration(settings.lastLoadMs);
      }
      const updateElapsed = () => {
        const seconds = Math.floor((performance.now() - startedAt) / 1000);
        const minutes = Math.floor(seconds / 60);
        banner.querySelector("[data-loading-elapsed]").textContent = "Elapsed · " + minutes + ":" + String(seconds % 60).padStart(2, "0");
      };
      updateElapsed();
      const elapsedTimer = setInterval(updateElapsed, 1000);
      const cleanup = () => {
        clearInterval(elapsedTimer);
        timers.forEach(clearTimeout);
        removeEventListener("resize", positionRows);
      };
      const positionRows = () => {
        const list = banner.querySelector(".checkpoints");
        const spacing = list.clientHeight / 5;
        const style = getComputedStyle(rows[0]);
        const gap = parseFloat(style.columnGap) || 0;
        // Size every row to the same longest bold label, so the whole block
        // stays centred without shifting when the active step changes.
        if (measureContext) measureContext.font = "750 " + style.fontSize + " " + style.fontFamily;
        const labelWidth = measureContext
          ? Math.max(...labels.map(label => measureContext.measureText(label).width))
          : list.clientWidth - 28 - gap - 20;
        list.style.setProperty("--checkpoint-group-width", Math.ceil(labelWidth + 28 + gap + 2) + "px");
        rows.forEach((row, index) => {
          const offset = index - stage;
          const distance = Math.abs(offset);
          const y = Math.max(-3, Math.min(3, offset)) * spacing;
          row.dataset.position = distance === 0 ? "current" : "nearby";
          row.dataset.offset = String(offset);
          row.style.transform = "translate(-50%, calc(-50% + " + y + "px))";
          row.style.opacity = String(distance === 0 ? 1 : distance === 1 ? .7 : distance === 2 ? .42 : 0);
          row.setAttribute("aria-hidden", String(distance > 2));
        });
      };
      addEventListener("resize", positionRows);
      addEventListener("pagehide", cleanup, { once: true });
      const renderStage = () => {
        rows.forEach((row, index) => {
          const skipped = skipScene && index >= 3 && index <= 6;
          const state = skipped ? "skipped" : finished || index < stage ? "complete" : index === stage ? "current" : "pending";
          row.dataset.state = state;
          row.querySelector(".step-number").textContent = state === "current" ? "" : (index + 1) + "/" + rows.length;
          row.querySelector(".step-label").textContent = labels[index] + (skipped ? " (not needed)" : "");
          if (skipped) row.setAttribute("title", "Not needed for this world or client configuration");
          else row.removeAttribute("title");
          if (state === "current") row.setAttribute("aria-current", "step");
          else row.removeAttribute("aria-current");
        });
        positionRows();
        banner.querySelector("[data-loading-announcement]").textContent = (stage + 1) + "/" + rows.length + " " + labels[stage];
      };
      globalThis.__veSetWorldLoadingStage = (next, sceneSkipped = false) => {
        if (finished || !Number.isInteger(next) || next < 0 || next >= rows.length) return;
        stage = Math.max(stage, next);
        skipScene = sceneSkipped === true;
        renderStage();
      };
      globalThis.__veSetWorldLoadingItem = (item) => {
        if (!finished && typeof item === "string" && item) {
          banner.querySelector("[data-loading-item]").textContent = item;
        }
      };
      globalThis.__veFinishWorldLoading = () => {
        finished = true;
        cleanup();
        updateElapsed();
        renderStage();
        banner.querySelector("[data-loading-item]").textContent = "Your world is ready";
        banner.classList.add("ve-world-loading-banner-hidden");
      };
      renderStage();
      timers.push(setTimeout(() => {
        banner.querySelector("[data-loading-message]").textContent = "Still working — large worlds, modules, or scene assets can extend loading time.";
      }, 30000));
      timers.push(setTimeout(() => {
        banner.querySelector("[data-loading-message]").textContent = "Foundry is still preparing the world. You can continue waiting; this screen will close when it is ready.";
      }, 90000));
    })();
  </script>
</body>
</html>`;
}
