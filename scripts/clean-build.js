const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

for (const entry of [".vite", "dist"]) {
  fs.rmSync(path.join(root, entry), { force: true, recursive: true });
}
