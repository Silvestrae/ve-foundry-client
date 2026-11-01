const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const helpers = { exports: {}, URL };
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
vm.runInNewContext(
  compile(
    fs.readFileSync(
      path.join(root, "src/utils/hostedServiceNavigation.ts"),
      "utf8",
    ),
  ),
  helpers,
);
const source = fs.readFileSync(path.join(root, "src/main.ts"), "utf8");
const tree = ts.createSourceFile(
  "main.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const code = compile(
  [
    "isAppRendererUrl",
    "shouldOpenInExternalBrowser",
    "hookExternalLinkHandling",
  ]
    .map((name) => {
      const node = tree.statements.find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      );
      assert.ok(node, name);
      return node.getText(tree);
    })
    .join("\n"),
);

function fixture(currentUrl, service) {
  const loads = [];
  const external = [];
  const timers = [];
  const events = {};
  let open;
  const win = {
    isDestroyed: () => false,
    loadURL: (url) => {
      loads.push(url);
      return Promise.resolve();
    },
    webContents: {
      id: 1,
      session: {},
      getURL: () => currentUrl,
      on: (name, callback) => (events[name] = callback),
      setWindowOpenHandler: (callback) => (open = callback),
    },
  };
  const context = {
    ...helpers.exports,
    URL,
    win,
    app: { isPackaged: true },
    windowsData: { 1: { hostedService: service } },
    getAppConfig: () => ({ externalLinksInDefaultBrowser: true }),
    openUrlInDefaultBrowser: (url) => external.push(url),
    autofillHostedCredentials: () => Promise.resolve(),
    setTimeout: (callback) => timers.push(callback),
    hookMenuShortcut: () => {},
    hookFavoritePopupShortcut: () => {},
    console,
  };
  vm.createContext(context);
  vm.runInContext(code + "\nhookExternalLinkHandling(win);", context);
  return { open, loads, external, timers, events, win, context };
}

const profiles = [
  ["https://example.test/game", null],
  ["https://fixture.games.sqyre.app/game", "sqyre"],
  ["https://fixture.games.sqyre.app/game", null],
  ["https://fixture.sqyre.app/game/world/", "sqyre"],
  ["https://fixture.sqyre.app/game", "sqyre"],
  ["https://fixture.forge-vtt.com/game", "forge"],
  ["https://fixture.games.sqyre.app/detached/index.html", "sqyre"],
];
for (const [current, service] of profiles) {
  const test = fixture(current, service);
  const url = new URL("detached/index.html", current).href;
  const response = test.open({ url });
  assert.equal(response.action, "allow", current);
  assert.equal(response.overrideBrowserWindowOptions.show, true, current);
  assert.equal(
    response.overrideBrowserWindowOptions.webPreferences.session,
    test.win.webContents.session,
  );
  assert.equal(response.overrideBrowserWindowOptions.parent, test.win);
  assert.equal(test.timers.length, 0);
  assert.equal(test.loads.length, 0);
  // A detached child must receive regular handlers and inherited data, but no
  // hosted-launch banner, transfer or hide listeners. Unexpected calls fail.
  const childEvents = [];
  const child = {
    webContents: {
      id: 2,
      getURL: () => url,
      session: test.win.webContents.session,
      on: (name) => childEvents.push(name),
      setWindowOpenHandler: () => {},
    },
    on: () => {},
  };
  test.events["did-create-window"](child, { url });
  assert.deepEqual(childEvents, [
    "dom-ready",
    "did-finish-load",
    "will-navigate",
    "did-create-window",
  ]);
  assert.ok(test.context.windowsData[2]);
}

const isDetached = helpers.exports.isFoundryDetachedWindowUrl;
assert.equal(
  isDetached(
    "https://example.test/game",
    "https://example.test/prefix/detached/index.html?x=1#tab",
  ),
  true,
);
for (const target of [
  "https://other.test/detached/index.html",
  "http://example.test/detached/index.html",
  "https://example.test:444/detached/index.html",
  "https://example.test/detached/index.html/extra",
  "https://example.test/game?next=/detached/index.html",
  "about:blank",
  "invalid",
]) {
  assert.equal(isDetached("https://example.test/game", target), false, target);
}
assert.equal(
  isDetached("invalid", "https://example.test/detached/index.html"),
  false,
);

for (const [current, service, target] of [
  [
    "https://www.sqyre.app/games/fixture",
    "sqyre",
    "https://fixture.games.sqyre.app/game",
  ],
  ["https://forge-vtt.com", "forge", "https://fixture.forge-vtt.com/game"],
]) {
  const test = fixture(current, service);
  assert.equal(test.open({ url: target }).action, "deny");
  test.timers.forEach((callback) => callback());
  assert.deepEqual(test.loads, [target]);
}
const external = fixture("https://example.test/game", null);
assert.equal(
  external.open({ url: "https://other.test/detached/index.html" }).action,
  "deny",
);
assert.deepEqual(external.external, ["https://other.test/detached/index.html"]);
const auth = fixture("https://www.sqyre.app", "sqyre");
assert.equal(
  auth.open({ url: "https://accounts.google.com/signin" }).action,
  "deny",
);
assert.equal(auth.timers.length, 1);
const portal = fixture("https://www.sqyre.app", "sqyre");
const portalResponse = portal.open({
  url: "https://www.sqyre.app/games/fixture",
});
assert.equal(portalResponse.action, "allow");
assert.equal(portalResponse.overrideBrowserWindowOptions.show, false);
console.log(
  "PASS detached popup routing and child lifecycle for 7 profiles; URL boundaries, hosted launches, authentication and external links preserved.",
);
