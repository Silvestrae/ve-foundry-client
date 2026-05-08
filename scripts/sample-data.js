const fs = require("fs");
const path = require("path");

const appData = process.env.APPDATA;
if (!appData) {
  throw new Error("APPDATA is not set. This helper is intended for Windows dev testing.");
}

const userDataPath = path.join(appData, "ve-foundry-client", "userData.json");
if (!fs.existsSync(userDataPath)) {
  throw new Error(`userData.json was not found at ${userDataPath}`);
}

const mode = process.argv[2] ?? "add";
const raw = fs.readFileSync(userDataPath, "utf8");
const data = JSON.parse(raw);

data.app ??= {};
data.app.games = Array.isArray(data.app.games) ? data.app.games : [];
data.app.favorites = Array.isArray(data.app.favorites) ? data.app.favorites : [];

const isDummyServer = (server) =>
  String(server?.name ?? "").startsWith("Dummy Test Server ");
const isDummyFavorite = (favorite) =>
  String(favorite?.name ?? "").startsWith("Dummy Test Favorite ");

data.app.games = data.app.games.filter((server) => !isDummyServer(server));
data.app.favorites = data.app.favorites.filter(
  (favorite) => !isDummyFavorite(favorite),
);

for (const key of Object.keys(data)) {
  if (/^9000\d+$/.test(key)) {
    delete data[key];
  }
}

if (mode === "add") {
  for (let i = 1; i <= 10; i += 1) {
    const id = 900000 + i;
    data.app.games.push({
      id,
      name: `Dummy Test Server ${i}`,
      url: `https://example.com/foundry/test-server-${i}`,
      cssId: `dummy-test-server-${i}`,
      autoLoginEnabled: true,
      serverInfoAutoRefreshDisabled: true,
    });
    data[id] = { user: "", password: [], adminPassword: [] };
  }

  for (let i = 1; i <= 10; i += 1) {
    data.app.favorites.push({
      id: 910000 + i,
      name: `Dummy Test Favorite ${i}`,
      url: `https://example.com/favorite-${i}`,
      iconUrl:
        "https://www.google.com/s2/favicons?domain_url=https%3A%2F%2Fexample.com&sz=64",
    });
  }
} else if (mode !== "remove") {
  throw new Error('Use "add" or "remove".');
}

fs.writeFileSync(userDataPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      mode,
      userDataPath,
      servers: data.app.games.length,
      favorites: data.app.favorites.length,
      dummyServers: data.app.games.filter(isDummyServer).length,
      dummyFavorites: data.app.favorites.filter(isDummyFavorite).length,
    },
    null,
    2,
  ),
);
