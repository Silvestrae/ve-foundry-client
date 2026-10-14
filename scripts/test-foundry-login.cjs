const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { app, BrowserWindow } = require("electron");

// Exercise the actual injected login script in Chromium, without connecting to a game.
const source = fs.readFileSync(path.join(__dirname, "../src/main.ts"), "utf8");
const ast = ts.createSourceFile(
  "main.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
let loginTemplate;
function findLoginTemplate(node) {
  if (
    ts.isTemplateExpression(node) &&
    node.head.text.includes("const credentials = ") &&
    node.templateSpans.length === 1 &&
    node.templateSpans[0].expression.getText(ast) === "loginPayload"
  ) {
    loginTemplate = node;
  }
  ts.forEachChild(node, findLoginTemplate);
}
findLoginTemplate(ast);
assert.ok(loginTemplate, "Found the production login injection");

const cases = [
  {
    name: "14.369 dropdown",
    field: '<select id="join-username" name="userId">',
    kind: "select",
  },
  {
    name: "camel-case userId without an ID",
    field: '<select name="userId">',
    kind: "select",
  },
  {
    name: "legacy userid dropdown",
    field: '<select name="userid">',
    kind: "select",
  },
  {
    name: "legacy user dropdown",
    field: '<select name="user">',
    kind: "select",
  },
  {
    name: "username dropdown",
    field: '<select name="username">',
    kind: "select",
  },
  {
    name: "14.366 text input",
    field: '<input id="join-username" name="username">',
    kind: "input",
  },
  {
    name: "username text input without an ID",
    field: '<input name="username">',
    kind: "input",
  },
  {
    name: "legacy userid text input",
    field: '<input name="userid">',
    kind: "input",
  },
  {
    name: "legacy user text input",
    field: '<input name="user">',
    kind: "input",
  },
  {
    name: "autofill without auto-login",
    field: '<select id="join-username" name="userId">',
    kind: "select",
    autoLogin: false,
  },
  {
    name: "unknown saved user",
    field: '<select id="join-username" name="userId">',
    kind: "select",
    user: "Missing",
    expectedUser: "",
    submits: 0,
  },
  {
    name: "connected user is disabled",
    field: '<select id="join-username" name="userId">',
    kind: "select",
    disabled: true,
    expectedUser: "",
    submits: 0,
  },
  {
    name: "saved internal user ID",
    field: '<select name="userid">',
    kind: "select",
    user: "user-id-2",
  },
  { name: "administrator authentication", kind: "auth", isAuthPage: true },
];

async function run() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  let failures = 0;
  try {
    for (const test of cases) {
      const credentials = {
        user: test.user ?? "Player2",
        password: "test-password",
        adminPassword: "test-admin-password",
        autoLogin: test.autoLogin ?? true,
        isAuthPage: test.isAuthPage ?? false,
      };
      const userField =
        test.kind === "select"
          ? `${test.field}<option value=""></option><option value="user-id-1">Player1</option><option value="user-id-2" ${test.disabled ? "disabled" : ""}> Player2 </option></select>`
          : (test.field ?? "");
      const gameForm =
        test.kind === "auth"
          ? ""
          : `<form id="join-game-form">${userField}<input name="password" type="password"><button name="join" type="submit">Join</button></form>`;
      await win.loadURL(
        `data:text/html,${encodeURIComponent(`${gameForm}<form id="join-game-setup"><input name="adminPassword" type="password"><button type="submit">Setup</button></form>`)}`,
      );
      await win.webContents.executeJavaScript(`
        window.loginSubmissions = [];
        window.fieldEvents = [];
        document.addEventListener("submit", event => {
          event.preventDefault();
          window.loginSubmissions.push(event.target.id);
        });
        for (const type of ["input", "change"]) {
          document.addEventListener(type, event => window.fieldEvents.push({ type, name: event.target.name }));
        }
      `);
      const script =
        loginTemplate.head.text +
        JSON.stringify(credentials) +
        loginTemplate.templateSpans[0].literal.text;
      await win.webContents.executeJavaScript(script);
      const result = await win.webContents
        .executeJavaScript(`new Promise(resolve => setTimeout(() => resolve({
        user: document.querySelector("select, input:not([type=password])")?.value,
        password: document.querySelector('input[name="password"]')?.value,
        adminPassword: document.querySelector('input[name="adminPassword"]')?.value,
        submissions: window.loginSubmissions,
        events: window.fieldEvents,
      }), 150))`);
      try {
        const expectedUser =
          test.expectedUser ??
          (test.kind === "select" ? "user-id-2" : credentials.user);
        if (test.kind !== "auth") {
          assert.equal(result.user, expectedUser, "Selected the saved user");
          assert.equal(
            result.password,
            credentials.password,
            "Filled the game password",
          );
          if (expectedUser) {
            for (const type of ["input", "change"]) {
              assert.ok(
                result.events.some(
                  (event) =>
                    event.type === type &&
                    !["password", "adminPassword"].includes(event.name),
                ),
                `Dispatched ${type} for the user field`,
              );
            }
          }
        }
        assert.equal(
          result.adminPassword,
          credentials.adminPassword,
          "Filled the administrator password",
        );
        const submits = test.submits ?? (credentials.autoLogin ? 1 : 0);
        assert.deepEqual(
          result.submissions,
          submits
            ? [test.kind === "auth" ? "join-game-setup" : "join-game-form"]
            : [],
          "Submitted only the expected login form",
        );
        console.log(`PASS ${test.name}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL ${test.name}: ${error.message}`);
      }
    }
  } finally {
    win.destroy();
  }
  console.log(
    `${cases.length - failures}/${cases.length} login compatibility checks passed`,
  );
  app.exit(failures ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  app.exit(1);
});
