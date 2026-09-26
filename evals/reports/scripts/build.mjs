// Builds every report under src/experiments and src/tournaments into one self-contained HTML
// file each (JavaScript, CSS and fonts inlined), written to experiments/ and tournaments/.
// Usage: pnpm build [name-substring]
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FAMILIES = ["experiments", "tournaments"];
const only = process.argv[2];

// A file opened from disk can't load sibling chunks or assets: fold them into the page.
function inline(html, bundle) {
  const asset = (ref) => bundle[ref.replace(/^\.?\//, "")];
  return html
    .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
      // `</script` inside the bundle would end the tag early.
      const code = asset(src).code.replaceAll("</script", "<\\/script");
      return `<script type="module">${code}</script>`;
    })
    .replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => {
      return `<style>${asset(href).source}</style>`;
    });
}

async function reports() {
  const found = [];
  for (const family of FAMILIES) {
    const dir = path.join(root, "src", family);
    for (const file of await readdir(dir).catch(() => [])) {
      if (file.endsWith(".tsx"))
        found.push({ family, name: file.slice(0, -4), file: path.join(dir, file) });
    }
  }
  return found.filter((r) => !only || r.name.includes(only));
}

for (const report of await reports()) {
  const outDir = await mkdtemp(path.join(tmpdir(), "report-"));
  let page;
  await build({
    root,
    configFile: path.join(root, "vite.config.ts"),
    logLevel: "warn",
    base: "./",
    resolve: { alias: { "@report": report.file } },
    build: {
      outDir,
      emptyOutDir: true,
      // Fonts and images become data URIs, so the page needs no other file.
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      cssCodeSplit: false,
      // One file by design: React, Macaw and the board are all inlined.
      chunkSizeWarningLimit: 4096,
      rolldownOptions: { output: { codeSplitting: false } },
    },
    plugins: [
      {
        name: "inline-report",
        enforce: "post",
        generateBundle(_, bundle) {
          page = inline(bundle["index.html"].source, bundle);
        },
      },
    ],
  });
  await rm(outDir, { recursive: true, force: true });
  const target = path.join(root, report.family, `${report.name}.html`);
  await writeFile(target, page);
  console.log(`${path.relative(root, target)}: ${(Buffer.byteLength(page) / 1024).toFixed(0)} KiB`);
}

// A built page whose source was renamed or deleted would go stale unnoticed.
for (const family of FAMILIES) {
  const built = await readdir(path.join(root, family)).catch(() => []);
  const sources = await readdir(path.join(root, "src", family)).catch(() => []);
  for (const html of built.filter((f) => f.endsWith(".html"))) {
    if (!sources.includes(html.replace(/\.html$/, ".tsx"))) {
      console.warn(
        `warning: ${family}/${html} has no src/${family}/${html.replace(/\.html$/, ".tsx")}`,
      );
    }
  }
}
