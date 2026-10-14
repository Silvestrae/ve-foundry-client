const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");

function loadTypeScript(relativePath) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

function testStoreAndSchema() {
  const { createPinia, setActivePinia } = require("pinia");
  const { useUpdaterStore } = loadTypeScript("src/stores/updater.ts");
  setActivePinia(createPinia());
  const store = useUpdaterStore();

  store.handleStatus({ status: "available", payload: { version: "1.2.3" } });
  store.handleStatus({ status: "progress", payload: { percent: 42 } });
  assert.equal(
    store.targetVersion,
    "1.2.3",
    "progress retains the target version",
  );
  store.handleStatus({ status: "installing" });
  assert.equal(
    store.targetVersion,
    "1.2.3",
    "payload-less installing retains the target version",
  );
  store.handleStatus({ status: "downloaded", payload: { version: "1.2.3" } });
  store.close();
  assert.equal(store.visible, false, "close hides the modal");
  assert.equal(store.status, "downloaded", "close retains downloaded status");
  assert.equal(
    store.targetVersion,
    "1.2.3",
    "close retains the target version",
  );

  const { AppConfigSchema } = loadTypeScript("src/schemas.ts");
  const parsed = AppConfigSchema.parse({
    games: [],
    ignoredUpdateVersion: "1.2.3",
  });
  assert.equal(
    parsed.ignoredUpdateVersion,
    "1.2.3",
    "schema preserves the ignored version",
  );
  console.log(
    "PASS store target retention, close state, and ignored-version schema",
  );
}

function createUpdaterHarness(platform = "win32") {
  const mainSource = fs.readFileSync(path.join(root, "src/main.ts"), "utf8");
  const ast = ts.createSourceFile(
    "main.ts",
    mainSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const selected = [];
  const wantedState = new Set([
    "initialCheckInProgress",
    "lastUpdateRequestingWindow",
    "targetUpdateVersion",
    "installAfterDownload",
    "downloadedUpdateFile",
  ]);

  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          wantedState.has(declaration.name.text)
        ) {
          selected.push(node.getText(ast));
          break;
        }
      }
    } else if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "installDownloadedUpdate"
    ) {
      selected.push(node.getText(ast));
    } else if (ts.isCallExpression(node)) {
      const call = node;
      const receiver = ts.isPropertyAccessExpression(call.expression)
        ? call.expression.expression.getText(ast)
        : "";
      const method = ts.isPropertyAccessExpression(call.expression)
        ? call.expression.name.text
        : "";
      const eventName =
        call.arguments[0] && ts.isStringLiteral(call.arguments[0])
          ? call.arguments[0].text
          : "";
      if (
        method === "then" &&
        call.arguments[0] &&
        ts.isArrowFunction(call.arguments[0]) &&
        call.arguments[0].parameters[0] &&
        ts.isIdentifier(call.arguments[0].parameters[0].name) &&
        call.arguments[0].parameters[0].name.text === "result" &&
        call.arguments[0].getText(ast).includes("result.isUpdateAvailable") &&
        call.arguments[0].getText(ast).includes("ignoredUpdateVersion")
      ) {
        selected.push(
          `globalThis.startupResultHandler = ${call.arguments[0].getText(ast)};`,
        );
      }
      if (
        (receiver === "autoUpdater" &&
          method === "on" &&
          [
            "checking-for-update",
            "update-available",
            "update-not-available",
            "download-progress",
            "update-downloaded",
            "error",
          ].includes(eventName)) ||
        (receiver === "ipcMain" &&
          method === "on" &&
          ["check-for-updates", "download-update", "install-update"].includes(
            eventName,
          ))
      ) {
        selected.push(node.getText(ast));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(
    selected.length,
    16,
    "extracted the production updater state, callbacks, and IPC handlers",
  );

  const updaterEvents = new Map();
  const ipcHandlers = new Map();
  const statuses = [];
  const calls = [];
  const windows = new Map();
  const config = {};
  const autoUpdater = {
    on(name, callback) {
      updaterEvents.set(name, callback);
    },
    checkForUpdates() {
      calls.push("check");
      return Promise.resolve();
    },
    downloadUpdate() {
      calls.push("download");
      return Promise.resolve();
    },
    quitAndInstall(...args) {
      calls.push(["quitAndInstall", ...args]);
    },
  };
  const ipcMain = {
    on(name, callback) {
      ipcHandlers.set(name, callback);
    },
  };
  const BrowserWindow = {
    fromWebContents(sender) {
      return windows.get(sender);
    },
  };
  const context = {
    autoUpdater,
    ipcMain,
    BrowserWindow,
    process: { platform },
    sendUpdateStatus(status, payload, win) {
      statuses.push({ status, payload, win });
    },
    enrichUpdateInfoWithReleaseNotes: async (info) => info,
    installDebUpdate(file) {
      calls.push(["installDebUpdate", file]);
    },
    app: { getVersion: () => "1.0.0" },
    isDev: false,
    mainWindow: { id: "startup-window" },
    getAppConfig: () => config,
  };
  const executable = ts.transpileModule(selected.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(executable, context, {
    filename: "src/main.ts updater extraction",
  });
  // Model a settled startup check before exercising user-triggered update events.
  vm.runInNewContext("initialCheckInProgress = false", context);
  return {
    updaterEvents,
    ipcHandlers,
    statuses,
    calls,
    windows,
    config,
    startupResultHandler: vm.runInNewContext("startupResultHandler", context),
  };
}

async function testMainUpdater() {
  const h = createUpdaterHarness();
  h.config.ignoredUpdateVersion = "2.3.4";
  const sender = { id: 1 };
  const win = { id: "requesting-window" };
  h.windows.set(sender, win);
  h.ipcHandlers.get("check-for-updates")({ sender });
  assert.deepEqual(h.calls, ["check"], "manual check reaches autoUpdater");
  assert.equal(h.statuses.at(-1).status, "checking");
  assert.equal(h.statuses.at(-1).win, win);

  h.updaterEvents.get("update-available")({ version: "2.3.4" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.statuses.at(-1).status, "available");
  assert.equal(
    h.statuses.at(-1).win,
    win,
    "availability goes to the requesting window",
  );
  assert.equal(
    h.statuses.at(-1).payload.silent,
    undefined,
    "manual checks still show a version the user previously ignored",
  );

  const startup = createUpdaterHarness();
  assert.equal(typeof startup.startupResultHandler, "function");
  startup.config.ignoredUpdateVersion = "2.3.4";
  await startup.startupResultHandler({
    isUpdateAvailable: true,
    updateInfo: { version: "2.3.4" },
  });
  assert.equal(
    startup.statuses.at(-1).payload.silent,
    true,
    "startup suppresses the ignored version",
  );
  startup.config.ignoredUpdateVersion = "2.3.3";
  await startup.startupResultHandler({
    isUpdateAvailable: true,
    updateInfo: { version: "2.3.4" },
  });
  assert.equal(
    startup.statuses.at(-1).payload.silent,
    false,
    "a different newer version remains visible",
  );
  const statusCount = startup.statuses.length;
  await startup.startupResultHandler({
    isUpdateAvailable: false,
    updateInfo: { version: "2.3.5" },
  });
  assert.equal(
    startup.statuses.length,
    statusCount,
    "non-available update result sends no update status",
  );

  h.ipcHandlers.get("download-update")({ sender });
  assert.equal(h.statuses.at(-1).status, "progress");
  assert.equal(h.statuses.at(-1).payload.version, "2.3.4");
  h.updaterEvents.get("download-progress")({ percent: 73 });
  assert.equal(
    JSON.stringify(h.statuses.at(-1).payload),
    JSON.stringify({ percent: 73, version: "2.3.4" }),
  );
  h.updaterEvents.get("update-downloaded")({
    version: "2.3.4",
    downloadedFile: "update.exe",
  });
  assert.equal(h.statuses.at(-2).status, "downloaded");
  assert.equal(
    h.statuses.at(-1).status,
    "installing",
    "requested auto-install starts after download",
  );
  assert.equal(h.statuses.at(-1).payload.version, "2.3.4");
  assert.deepEqual(h.calls.at(-1), ["quitAndInstall", true, true]);

  const linux = createUpdaterHarness("linux");
  const linuxSender = { id: 2 };
  const linuxWin = { id: "linux-window" };
  linux.windows.set(linuxSender, linuxWin);
  linux.updaterEvents.get("update-downloaded")({
    version: "2.3.4",
    downloadedFile: "/tmp/client.deb",
  });
  linux.ipcHandlers.get("install-update")({ sender: linuxSender });
  assert.deepEqual(
    linux.calls,
    [["installDebUpdate", "/tmp/client.deb"]],
    "Linux deb uses the deb installer",
  );
  assert.equal(linux.statuses.at(-1).win, linuxWin);

  const failed = createUpdaterHarness();
  const failedSender = { id: 3 };
  failed.windows.set(failedSender, { id: "failed-window" });
  failed.ipcHandlers.get("download-update")({ sender: failedSender });
  failed.updaterEvents.get("error")(new Error("download failed"));
  failed.updaterEvents.get("update-downloaded")({
    version: "2.3.4",
    downloadedFile: "update.exe",
  });
  assert.equal(
    failed.calls.some(
      (call) => Array.isArray(call) && call[0] === "quitAndInstall",
    ),
    false,
    "download error cancels automatic installation",
  );
  console.log("PASS production updater callbacks and IPC routing");
}

async function main() {
  testStoreAndSchema();
  await testMainUpdater();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
