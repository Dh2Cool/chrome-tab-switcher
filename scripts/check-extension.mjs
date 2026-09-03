import { access, readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const paths = [
  manifest.background.service_worker,
  manifest.action.default_popup,
  manifest.options_ui.page,
  "src/overlay.js",
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon)
];

await Promise.all([...new Set(paths)].map((path) => access(path)));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3 is required");
if (manifest.host_permissions?.length) throw new Error("Unexpected host permissions");
console.log(`Extension ${manifest.name} v${manifest.version} passed structural checks.`);
