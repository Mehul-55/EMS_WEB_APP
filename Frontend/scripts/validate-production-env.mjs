import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.production");
const exampleHosts = new Set(["your-backend-domain.com"]);
const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function readDotEnvValue(filePath, key) {
  if (!existsSync(filePath)) return "";
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    if (match[1].trim() === key) {
      return match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

const apiBase = process.env.VITE_API_BASE_URL || readDotEnvValue(envPath, "VITE_API_BASE_URL");

if (!apiBase) {
  throw new Error("Set VITE_API_BASE_URL to your live backend URL before production build.");
}

let apiUrl;
try {
  apiUrl = new URL(apiBase);
} catch {
  throw new Error("VITE_API_BASE_URL must be a valid absolute URL.");
}

if (apiUrl.protocol !== "https:") {
  throw new Error("VITE_API_BASE_URL must use https in production.");
}

if (localHosts.has(apiUrl.hostname) || exampleHosts.has(apiUrl.hostname)) {
  throw new Error("VITE_API_BASE_URL must point to the deployed backend, not localhost or an example domain.");
}

console.log(`Production API URL ok: ${apiUrl.origin}`);
