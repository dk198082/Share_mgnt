import fs from "node:fs";

const userAgent = process.env.npm_config_user_agent || "";

if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}

fs.rmSync("package-lock.json", { force: true });
fs.rmSync("yarn.lock", { force: true });

console.log("Package manager check passed.");