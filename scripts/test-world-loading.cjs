const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const os = require("node:os");
const crypto = require("node:crypto");
const Module = require("node:module");
const ts = require("typescript");
const { app, BrowserWindow } = require("electron");

const root = path.join(__dirname, "..");
const file = path.join(root, "src/utils/worldLoadingScreen.ts");
const compiled = new Module(file, module);
compiled._compile(
  ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  file,
);
const {
  createWorldLoadingHtml,
  worldLoadingProgressScript,
  worldLoadingCheckpoints,
} = compiled.exports;
const timingFile = path.join(root, "src/utils/worldLoadTimes.ts");
const timingModule = new Module(timingFile, module);
timingModule._compile(
  ts.transpileModule(fs.readFileSync(timingFile, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText,
  timingFile,
);
const { createWorldLoadTimeStore } = timingModule.exports;
const options = {
  worldName: "The Verdant Expanse",
  iconUrl:
    "data:image/png;base64," +
    fs
      .readFileSync(path.join(root, "src/icons/desktop.png"))
      .toString("base64"),
  backgroundColor: "#0e1a23",
  accentColor: "#98e4f7",
  textColor: "#88c0a9",
  lastLoadMs: 87300,
};

function testSavedTimes() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ve-world-load-times-"),
  );
  const filePath = path.join(directory, "times.json");
  const errors = [];
  try {
    const store = createWorldLoadTimeStore(filePath, (error) =>
      errors.push(error),
    );
    assert.equal(store.get("tile-1"), null);
    store.record("tile-1", 87300);
    store.record("tile-2", 45600);
    const restarted = createWorldLoadTimeStore(filePath);
    assert.equal(
      restarted.get("tile-1"),
      87300,
      "Last successful load survives a new app session",
    );
    assert.equal(
      restarted.get("tile-2"),
      45600,
      "Each server tile retains its own timing",
    );
    store.record("tile-1", NaN);
    store.record("tile-1", -1);
    assert.equal(store.get("tile-1"), 87300);
    assert.equal(store.get("constructor"), null);
    const unavailable = createWorldLoadTimeStore(
      path.join(filePath, "blocked.json"),
      (error) => errors.push(error),
    );
    assert.doesNotThrow(
      () => unavailable.record("tile-1", 100),
      "A disk error cannot interrupt world entry",
    );
    assert.equal(store.get("tile-1"), 87300);
    fs.writeFileSync(filePath, "{malformed");
    assert.equal(store.get("tile-1"), null);
    store.record("tile-1", 1000);
    assert.equal(
      store.get("tile-1"),
      1000,
      "An invalid timing file can be recovered",
    );
    assert.ok(errors.length > 0);
    assert.deepEqual(
      fs.readdirSync(directory),
      ["times.json"],
      "Atomic writes leave no temporary files",
    );
    console.log(
      "PASS persistent load times, server isolation, invalid data, and disk errors",
    );
  } finally {
    fs.rmSync(filePath, { force: true });
    fs.rmdirSync(directory);
  }
}

function testProgress() {
  const context = vm.createContext({});
  assert.equal(vm.runInContext(worldLoadingProgressScript, context).stage, 0);
  const hooks = new Map();
  let registrations = 0;
  context.Hooks = {
    once(name, callback) {
      hooks.set(name, callback);
      registrations += 1;
    },
  };
  vm.runInContext(worldLoadingProgressScript, context);
  vm.runInContext(worldLoadingProgressScript, context);
  assert.equal(
    registrations,
    7,
    "Hooks install once, even when unavailable during the first poll",
  );
  assert.equal(worldLoadingCheckpoints.length, 8);
  worldLoadingCheckpoints
    .filter((checkpoint) => checkpoint.hook)
    .forEach((checkpoint, index) => {
      hooks.get(checkpoint.hook)();
      assert.equal(
        vm.runInContext(worldLoadingProgressScript, context).stage,
        index + 1,
      );
    });
  hooks.get("init")();
  assert.equal(
    vm.runInContext(worldLoadingProgressScript, context).stage,
    7,
    "Stages never move backwards",
  );
  context.game = { ready: true };
  assert.equal(
    vm.runInContext(worldLoadingProgressScript, context).ready,
    true,
  );
  context.game = { settings: { get: () => true } };
  assert.equal(
    vm.runInContext(worldLoadingProgressScript, context).skipScene,
    true,
    "Disabled canvas skips scene checkpoints",
  );
  context.game = { scenes: { current: null, active: null } };
  assert.equal(
    vm.runInContext(worldLoadingProgressScript, context).skipScene,
    true,
    "Worlds without an active scene skip scene checkpoints",
  );
  const legacy = vm.createContext({ game: { ready: true } });
  assert.equal(
    vm.runInContext(worldLoadingProgressScript, legacy).ready,
    true,
    "Readiness works without Hooks",
  );
  legacy.game.settings = { get: () => true };
  assert.equal(
    vm.runInContext(worldLoadingProgressScript, legacy).skipScene,
    true,
    "Late observers still detect disabled canvas",
  );
  console.log("PASS Foundry lifecycle progress and compatibility fallback");
}

async function testOverlayLifecycle(parent, dismissal = null) {
  // Run the production Electron window controller, including its polling and
  // cleanup, against a local Foundry lifecycle fixture rather than a real game.
  const main = ts.createSourceFile(
    "main.ts",
    fs.readFileSync(path.join(root, "src/main.ts"), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set([
    "showWorldLoadingOverlay",
    "closeWorldLoadingOverlay",
  ]);
  const functions = main.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text),
  );
  assert.equal(functions.length, 2);
  const windowsData = {
    [parent.webContents.id]: {
      selectedServerName: options.worldName,
      gameId: "tile-1",
    },
  };
  const recordedTimes = [];
  let releaseOverlayLoad;
  const overlayLoadGate = new Promise((resolve) => {
    releaseOverlayLoad = resolve;
  });
  const context = vm.createContext({
    BrowserWindow: function (settings) {
      const window = new BrowserWindow(settings);
      const loadURL = window.loadURL.bind(window);
      window.loadURL = (...args) =>
        overlayLoadGate.then(() => loadURL(...args));
      return window;
    },
    windowsData,
    createWorldLoadingHtml,
    worldLoadingProgressScript,
    worldLoadingIcon: options.iconUrl,
    worldLoadingStartedAt: new Map(),
    worldLoadTimes: {
      get: () => options.lastLoadMs,
      record: (key, ms) => recordedTimes.push({ key, ms }),
    },
    performance,
    crypto,
    getThemeConfig: () => options,
    isFoundryGameUrl: () => true,
    getHostedServiceFromUrl: () => null,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(
    ts.transpileModule(
      "const worldLoadingOverlays = new Map();\n" +
        functions.map((node) => node.getText(main)).join("\n") +
        "\nglobalThis.overlays = worldLoadingOverlays;",
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      },
    ).outputText,
    context,
  );
  await parent.loadURL("data:text/html,Foundry lifecycle fixture");
  await parent.webContents.executeJavaScript(
    "globalThis.game = { ready: false }; globalThis.callbacks = {}; globalThis.Hooks = { once: (name, callback) => { callbacks[name] = callback; } }; true;",
  );
  parent.showInactive();
  context.showWorldLoadingOverlay(parent);
  const overlay = context.overlays.get(parent.webContents.id);
  context.showWorldLoadingOverlay(parent);
  assert.equal(
    context.overlays.size,
    1,
    "Repeated dom-ready cannot duplicate the overlay",
  );
  const until = async (predicate) => {
    const deadline = Date.now() + 5000;
    while (!(await predicate())) {
      if (Date.now() > deadline)
        throw Error("Overlay lifecycle did not settle");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    await until(() =>
      parent.webContents.executeJavaScript(
        'typeof callbacks.init === "function"',
      ),
    );
    await parent.webContents.executeJavaScript(
      "callbacks.init(); callbacks.setup();",
    );
    assert.equal(
      overlay.webContents.getURL(),
      "",
      "Foundry checkpoints are captured before the overlay even loads",
    );
    const overlayLoaded = new Promise((resolve) =>
      overlay.webContents.once("did-finish-load", resolve),
    );
    releaseOverlayLoad();
    await overlayLoaded;
    await until(() =>
      overlay.webContents.executeJavaScript(
        'document.querySelectorAll("[data-state=complete]").length === 3',
      ),
    );
    assert.equal(
      recordedTimes.length,
      0,
      "Incomplete loads do not overwrite the last success",
    );
    assert.equal(
      await overlay.webContents.executeJavaScript(
        'document.querySelector("[data-loading-previous]").textContent',
      ),
      "Last load time · 1:27",
    );
    // Native window/menu geometry can settle after the renderer has loaded.
    await until(() => {
      const actual = overlay.getBounds();
      const expected = parent.getContentBounds();
      return Object.keys(expected).every(
        (key) => actual[key] === expected[key],
      );
    }).catch((error) => {
      console.error(
        "Overlay bounds:",
        overlay.getBounds(),
        "Parent content:",
        parent.getContentBounds(),
      );
      throw error;
    });
    assert.deepEqual(
      overlay.getBounds(),
      parent.getContentBounds(),
      "Overlay covers the full game content",
    );
    parent.setContentSize(900, 600);
    parent.emit("resize");
    assert.deepEqual(
      overlay.getBounds(),
      parent.getContentBounds(),
      "Overlay follows resizing",
    );
    if (dismissal) {
      overlay.focus();
      if (dismissal === "button") {
        const point = await overlay.webContents.executeJavaScript(`(() => {
          const bounds = document.querySelector(".close-loading").getBoundingClientRect();
          return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
        })()`);
        overlay.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...point,
        });
        overlay.webContents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          ...point,
        });
      } else {
        overlay.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        overlay.webContents.sendInputEvent({
          type: "keyUp",
          keyCode: "Escape",
        });
      }
      await until(() => !overlay.isVisible());
      assert.equal(parent.isDestroyed(), false, "Dismissal keeps Foundry open");
      assert.equal(
        await parent.webContents.executeJavaScript("game.ready"),
        false,
      );
      assert.equal(
        recordedTimes.length,
        0,
        "Dismissal does not claim a successful load",
      );
      parent.emit("focus");
      parent.emit("resize");
      context.showWorldLoadingOverlay(parent);
      assert.equal(
        overlay.isVisible(),
        false,
        "Dismissed overlay stays hidden after focus, resize and dom-ready",
      );
      assert.equal(context.overlays.get(parent.webContents.id), overlay);
    }
    const closed = new Promise((resolve) => overlay.once("closed", resolve));
    await parent.webContents.executeJavaScript("game.ready = true;");
    await until(() => overlay.isDestroyed());
    await closed;
    assert.equal(
      recordedTimes.length,
      1,
      "Only ready worlds update the saved timing",
    );
    assert.ok(recordedTimes[0].ms > 0);
    assert.equal(context.overlays.size, 0);
    assert.equal(
      parent.listenerCount("resize"),
      0,
      "Window listeners are removed on completion",
    );
    windowsData[parent.webContents.id].hostedService = "forge";
    context.showWorldLoadingOverlay(parent);
    assert.equal(
      context.overlays.size,
      0,
      "Hosted-service launch flow is preserved",
    );
    console.log(
      dismissal
        ? `PASS ${dismissal} dismissal keeps Foundry loading and records its eventual successful timing`
        : "PASS production overlay sizing, progress, completion, cleanup, and hosted exclusion",
    );
  } finally {
    releaseOverlayLoad();
    if (!overlay.isDestroyed()) overlay.destroy();
    parent.hide();
  }
}

async function run() {
  testSavedTimes();
  testProgress();
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    width: 1280,
    height: 800,
    useContentSize: true,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  });
  const blocked = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  const previewIndex = process.argv.indexOf("--preview-dir");
  const previewDir = previewIndex < 0 ? null : process.argv[previewIndex + 1];
  if (previewDir) fs.mkdirSync(previewDir, { recursive: true });
  const capture = async (name) => {
    if (!previewDir) return;
    await win.webContents.executeJavaScript(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    );
    fs.writeFileSync(
      path.join(previewDir, name),
      (await win.webContents.capturePage()).toPNG(),
    );
  };
  const load = async (settings = options) => {
    await win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(createWorldLoadingHtml(settings)),
    );
    await win.webContents.executeJavaScript("document.images[0].decode()");
  };
  const states = () =>
    win.webContents.executeJavaScript(
      'Array.from(document.querySelectorAll(".checkpoints li"), row => row.dataset.state)',
    );
  const assertScrollingList = async (stage) => {
    const listState = await win.webContents.executeJavaScript(`(async () => {
      const list = document.querySelector(".checkpoints");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        list.getBoundingClientRect();
        const transitions = document.getAnimations().filter(animation => animation instanceof CSSTransition);
        if (!transitions.length) break;
        const settled = await Promise.allSettled(transitions.map(animation => animation.finished));
        for (const result of settled) {
          // Resizing can cancel a transition and replace it with a new one.
          if (result.status === "rejected" && result.reason?.name !== "AbortError") throw result.reason;
        }
      }
      const bounds = list.getBoundingClientRect();
      const current = list.querySelector('[data-position="current"]');
      const row = current.getBoundingClientRect();
      const labelWidths = Array.from(list.children, element => {
        const range = document.createRange();
        range.selectNodeContents(element.querySelector(".step-label"));
        return range.getBoundingClientRect().width;
      });
      return {
        centerDifference: Math.abs(row.top + row.height / 2 - bounds.top - bounds.height / 2),
        horizontalCenterDifference: Math.abs(row.left + row.width / 2 - bounds.left - bounds.width / 2),
        extraGroupWidth: row.width - 28 - parseFloat(getComputedStyle(current).columnGap) - Math.max(...labelWidths),
        counter: current.querySelector(".step-number").textContent,
        loadingCircle: getComputedStyle(current.querySelector(".step-number"), "::after").animationName === "spin",
        offset: current.dataset.offset,
        visible: Array.from(list.children, element => ({
          offset: Number(element.dataset.offset),
          opacity: Number(getComputedStyle(element).opacity),
          height: element.getBoundingClientRect().height,
          filter: getComputedStyle(element).filter,
          transform: getComputedStyle(element).transform,
          counter: element.querySelector(".step-number").textContent,
          labelLeft: element.querySelector(".step-label").getBoundingClientRect().left,
          labelClipped: element.querySelector(".step-label").scrollWidth > element.querySelector(".step-label").clientWidth,
        })).filter(element => element.opacity > 0),
        currentHeight: row.height,
        announcement: document.querySelector("[data-loading-announcement]").textContent,
        label: current.querySelector(".step-label").textContent,
      };
    })()`);
    assert.ok(
      listState.centerDifference < 1,
      `Step ${stage + 1} stays in the centre`,
    );
    assert.ok(
      listState.horizontalCenterDifference < 1,
      "The left-aligned group is horizontally centred in the box",
    );
    assert.ok(
      listState.extraGroupWidth < 20,
      "The group does not reserve excessive blank space to the right",
    );
    assert.equal(
      listState.counter,
      "",
      "The loading circle replaces the current step number",
    );
    assert.equal(
      listState.loadingCircle,
      true,
      "The current step has an animated loading circle",
    );
    assert.equal(listState.offset, "0");
    assert.equal(listState.announcement, `${stage + 1}/8 ${listState.label}`);
    const expectedOffsets = [-2, -1, 0, 1, 2].filter(
      (offset) => stage + offset >= 0 && stage + offset < 8,
    );
    assert.deepEqual(
      listState.visible.map((row) => row.offset),
      expectedOffsets,
      "Only two preceding and two following steps are visible",
    );
    for (const row of listState.visible) {
      if (row.offset !== 0) {
        assert.ok(row.opacity < 1, "Neighbouring steps fade away");
        assert.equal(
          row.counter,
          `${stage + row.offset + 1}/8`,
          "Neighbouring rows retain their step counts",
        );
        assert.ok(
          Math.abs(row.height - listState.currentHeight) < 1,
          "All steps retain the same height in a flat list",
        );
      }
      assert.equal(row.filter, "none", "Step text remains sharp");
      assert.ok(
        Math.abs(row.labelLeft - listState.visible[0].labelLeft) < 1,
        "Step labels share a uniform column",
      );
      assert.equal(
        row.labelClipped,
        false,
        "Visible step labels have enough room",
      );
      assert.ok(
        !row.transform.startsWith("matrix3d"),
        "Steps use a simple vertical translation",
      );
    }
  };
  try {
    await testOverlayLifecycle(blocked);
    await testOverlayLifecycle(blocked, "button");
    await testOverlayLifecycle(blocked, "escape");
    await load();
    assert.deepEqual(await states(), ["current", ...Array(7).fill("pending")]);
    await assertScrollingList(0);
    for (let stage = 1; stage < 8; stage += 1) {
      await win.webContents.executeJavaScript(
        `__veSetWorldLoadingStage(${stage})`,
      );
      assert.deepEqual(await states(), [
        ...Array(stage).fill("complete"),
        "current",
        ...Array(7 - stage).fill("pending"),
      ]);
      await assertScrollingList(stage);
    }
    await win.webContents.executeJavaScript(
      "__veSetWorldLoadingStage(0); __veSetWorldLoadingStage(99); __veSetWorldLoadingStage(NaN)",
    );
    assert.deepEqual(await states(), [...Array(7).fill("complete"), "current"]);
    await load();
    await win.webContents.executeJavaScript("__veSetWorldLoadingStage(4)");
    await assertScrollingList(4);
    console.log(
      "PASS flat scrolling list centring, sharp text, faded neighbours, and startup/end boundaries",
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector("[data-loading-previous]").textContent',
      ),
      "Last load time · 1:27",
    );
    assert.notEqual(
      await win.webContents.executeJavaScript(
        'getComputedStyle(document.getElementById("ve-world-loading-banner"), "::before").backgroundImage',
      ),
      "none",
      "The smooth gradient is supported by the bundled browser",
    );
    await win.webContents.executeJavaScript(
      '__veSetWorldLoadingItem("World data: actors.db")',
    );

    await blocked.loadURL("data:text/html,Foundry renderer fixture");
    assert.notEqual(
      win.webContents.getOSProcessId(),
      blocked.webContents.getOSProcessId(),
    );
    const busy = blocked.webContents.executeJavaScript(
      "(() => { const end = performance.now() + 1800; while (performance.now() < end) {} })()",
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const elapsed = await win.webContents.executeJavaScript(
      'document.querySelector("[data-loading-elapsed]").textContent',
    );
    assert.notEqual(
      elapsed,
      "Elapsed · 0:00",
      "Clock continues while Foundry's renderer is blocked",
    );
    await busy;
    await capture("world-loading-desktop.png");
    const pixels = await win.webContents.capturePage();
    const pixelSize = pixels.getSize();
    const bitmap = pixels.toBitmap();
    const viewport = await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector(".activity").getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, cardX: card.x + card.width / 2, cardY: card.y + card.height / 2 };
    })()`);
    const alphaAt = (x, y) => bitmap[(y * pixelSize.width + x) * 4 + 3];
    assert.ok(
      Math.abs(alphaAt(4, pixelSize.height - 5) - 230) <= 1,
      "The rendered background is 90% opaque",
    );
    assert.equal(
      alphaAt(
        Math.floor((viewport.cardX * pixelSize.width) / viewport.width),
        Math.floor((viewport.cardY * pixelSize.height) / viewport.height),
      ),
      255,
      "The progress card stays completely opaque",
    );
    console.log(
      "PASS rendered background transparency and solid progress card",
    );
    console.log("PASS checkpoint rendering and independent elapsed clock");

    for (const [width, height] of [
      [640, 480],
      [360, 640],
      [1280, 360],
    ]) {
      win.setContentSize(width, height);
      const layout = await win.webContents.executeJavaScript(`(() => {
        const surface = document.getElementById("ve-world-loading-banner");
        const card = document.querySelector(".activity").getBoundingClientRect();
        return { fits: card.left >= 0 && card.right <= innerWidth, horizontalOverflow: surface.scrollWidth > surface.clientWidth };
      })()`);
      assert.equal(
        layout.fits,
        true,
        `Progress card fits ${width} × ${height}`,
      );
      assert.equal(layout.horizontalOverflow, false);
      await assertScrollingList(4);
      await capture(`world-loading-${width}x${height}.png`);
    }
    console.log("PASS compact and short-window layouts");

    await win.webContents.executeJavaScript(
      "__veFinishWorldLoading(); __veSetWorldLoadingStage(0); __veSetWorldLoadingItem('Late request')",
    );
    assert.deepEqual(await states(), Array(8).fill("complete"));
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector("[data-loading-item]").textContent',
      ),
      "Your world is ready",
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.getElementById("ve-world-loading-banner").classList.contains("ve-world-loading-banner-hidden")',
      ),
      true,
    );
    console.log("PASS completion freezes activity and fades the screen");

    await load({ ...options, lastLoadMs: null, initialElapsedMs: 5000 });
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector("[data-loading-previous]").textContent',
      ),
      "Last load time · —",
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector("[data-loading-elapsed]").textContent',
      ),
      "Elapsed · 0:05",
    );
    await win.webContents.executeJavaScript(
      "__veSetWorldLoadingStage(7, true); __veFinishWorldLoading();",
    );
    assert.deepEqual(await states(), [
      "complete",
      "complete",
      "complete",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
      "complete",
    ]);
    console.log(
      "PASS first-load timing, pre-render elapsed time, and skipped scene checkpoints",
    );

    if (previewDir) {
      win.setContentSize(627, 661);
      await load({
        ...options,
        worldName: "Rise of Vecna",
        backgroundColor: "#28231f",
        accentColor: "#ff7800",
        textColor: "#f6dc8c",
        lastLoadMs: 33400,
      });
      await win.webContents.executeJavaScript(
        '__veSetWorldLoadingStage(1); __veSetWorldLoadingItem("Processing downloaded world data...");',
      );
      await assertScrollingList(1);
      await capture("world-loading-centered-warm.png");
    }

    await load({
      ...options,
      worldName: '</script><img src=x onerror="globalThis.injected=true">',
      accentColor: "red; } body { display: none",
    });
    assert.equal(
      await win.webContents.executeJavaScript(
        'document.querySelector("[data-loading-heading]").textContent',
      ),
      '</script><img src=x onerror="globalThis.injected=true">',
    );
    assert.equal(
      await win.webContents.executeJavaScript("Boolean(globalThis.injected)"),
      false,
    );
    assert.equal(
      await win.webContents.executeJavaScript(
        'getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()',
      ),
      "#98e4f7",
    );
    console.log("PASS saved names and colours cannot inject markup or styles");
  } finally {
    win.destroy();
    blocked.destroy();
  }
  app.exit(0);
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
