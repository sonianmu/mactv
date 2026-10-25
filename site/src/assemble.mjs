// Puts the page together: page.src.html + the drawing kit's CSS + materials + the figure from build.mjs.
// Writes site/public/index.html, a single self-contained file (fonts load from Google Fonts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = dirname(fileURLToPath(import.meta.url));
const SITE = join(SRC, "..");
const read = (...p) => readFileSync(join(...p), "utf8");

const kitCss = "/* Figure styles from Anatomy (MIT License, Copyright (c) 2026 Ryan), https://github.com/wheresryan22/anatomy */\n" + read(SITE, "vendor", "anatomy", "iso.css");
const page = read(SRC, "page.src.html")
  .replace("/*ISO_CSS*/", () => kitCss)
  .replace("/*MATERIALS*/", () => read(SRC, "materials.css"))
  .replace("<!--FIG-->", () => read(SITE, ".build", "fig.svg"))
  .replace("/*FIGJSON*/", () => read(SITE, ".build", "fig.json"));

// split at the end of the style block: everything before it is head material, the rest is the body
const cut = page.indexOf("</style>") + "</style>".length;
const head = page.slice(0, cut).replace(/<meta name="claude:[^>]*>\n?/, "");
const body = page.slice(cut).trim();
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="MacTV shares your Mac with your TV: the Mac runs a separate desktop for the TV, and both can be used at once.">
${head.replace(/<title>[^<]*<\/title>/, "<title>MacTV</title>")}
</head>
<body>
${body}
</body>
</html>
`;
mkdirSync(join(SITE, "public"), { recursive: true });
writeFileSync(join(SITE, "public", "index.html"), html);
console.log("site/public/index.html:", (html.length / 1024).toFixed(0), "KB");
