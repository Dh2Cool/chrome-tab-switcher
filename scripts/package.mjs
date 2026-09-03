import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

await mkdir("dist", { recursive: true });
const output = `dist/recent-tabs-switcher.zip`;
await rm(output, { force: true });

const zip = spawn("zip", ["-r", output, "manifest.json", "src", "assets", "PRIVACY.md"], { stdio: "inherit" });
const code = await new Promise((resolve) => zip.on("close", resolve));
if (code !== 0) process.exit(code);
console.log(`Created ${output}`);
