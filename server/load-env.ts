import { existsSync } from "fs";
import path from "path";
import { config as loadDotenv } from "dotenv";

const candidateEnvPaths = [
  path.resolve(process.cwd(), ".env"),
  process.argv[1] ? path.resolve(path.dirname(process.argv[1]), "../.env") : "",
].filter(Boolean);

const loadedPaths = new Set<string>();

for (const envPath of candidateEnvPaths) {
  if (loadedPaths.has(envPath) || !existsSync(envPath)) continue;
  loadDotenv({ path: envPath, override: false });
  loadedPaths.add(envPath);
}
