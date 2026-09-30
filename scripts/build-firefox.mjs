// Build the Firefox version into dist/firefox (and dist/geo-meta-trainer-firefox.zip).
// Same source as Chrome; only the manifest differs (manifest.firefox.json).
//   node scripts/build-firefox.mjs
// Then in Firefox: about:debugging -> This Firefox -> Load Temporary Add-on ->
// pick dist/firefox/manifest.json. A permanent install needs the zip signed
// by Mozilla (addons.mozilla.org, "On your own" / unlisted is fine).
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SHIPPED = ["background.js", "sidepanel.html", "sidepanel.css", "sidepanel.js", "lib", "ui", "icons"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "firefox");
const zip = join(root, "dist", "geo-meta-trainer-firefox.zip");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of SHIPPED) cpSync(join(root, f), join(out, f), { recursive: true });
cpSync(join(root, "manifest.firefox.json"), join(out, "manifest.json"));

// bsdtar (Windows 10+, macOS) writes a zip when asked; fall back to zip(1).
if (existsSync(zip)) rmSync(zip);
const entries = ["manifest.json", ...SHIPPED];
const tar = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
try {
  execFileSync(tar, ["-a", "-c", "-f", zip, ...entries], { cwd: out, stdio: "ignore" });
} catch {
  try {
    execFileSync("zip", ["-r", "-q", zip, ...entries], { cwd: out, stdio: "ignore" });
  } catch {
    console.log("Could not create the zip (no tar or zip found); the folder is ready.");
  }
}
console.log(`Firefox build: ${out}${existsSync(zip) ? `\nZip: ${zip}` : ""}`);
