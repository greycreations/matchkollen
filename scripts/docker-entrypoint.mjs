import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const configPath = resolve(root, "dist/server/wrangler.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(config.d1_databases) || !config.d1_databases.length) {
  throw new Error("Wrangler-konfigurationen saknar D1-databas.");
}
config.d1_databases = config.d1_databases.map((binding) => ({ ...binding, migrations_dir: "../../drizzle" }));
const dockerConfigPath = resolve(root, "dist/server/docker-wrangler.json");
await writeFile(dockerConfigPath, JSON.stringify(config, null, 2));

const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const persistTo = process.env.MATCHKOLLEN_DATA_DIR || "/data/wrangler";
function run(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ["--import", "./scripts/sites-env.mjs", wrangler, ...args], { cwd: root, stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`Wrangler avslutades (${signal ?? code}).`)));
  });
}

const databaseName = config.d1_databases[0].database_name;
await run(["d1", "migrations", "apply", databaseName, "--local", "--config", dockerConfigPath, "--persist-to", persistTo]);
await run(["dev", "--config", configPath, "--local", "--persist-to", persistTo, "--ip", "0.0.0.0", "--port", process.env.PORT || "8787", "--inspector-port", "0"]);
