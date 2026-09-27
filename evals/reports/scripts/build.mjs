// Builds each report under src/experiments into one self-contained HTML file (JavaScript, CSS
// and fonts inlined), written to experiments/. A report is a snapshot, so a built one is rebuilt
// only when named. Usage: pnpm build [name-substring]
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite-plus";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sources = path.join(root, "src", "experiments");
const built = path.join(root, "experiments");
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

const isBuilt = (name) =>
  access(path.join(built, `${name}.html`)).then(
    () => true,
    () => false,
  );

async function reports() {
  const found = (await readdir(sources))
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => ({ name: file.slice(0, -4), file: path.join(sources, file) }));
  if (only) return found.filter((r) => r.name.includes(only));
  const unbuilt = await Promise.all(found.map(async (r) => !(await isBuilt(r.name))));
  return found.filter((_, i) => unbuilt[i]);
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
  const target = path.join(built, `${report.name}.html`);
  await writeFile(target, page);
  console.log(`${path.relative(root, target)}: ${(Buffer.byteLength(page) / 1024).toFixed(0)} KiB`);
}

// A built page whose source was renamed or deleted would go stale unnoticed.
const tsx = await readdir(sources);
for (const html of (await readdir(built)).filter((f) => f.endsWith(".html"))) {
  const source = html.replace(/\.html$/, ".tsx");
  if (!tsx.includes(source))
    console.warn(`warning: experiments/${html} has no src/experiments/${source}`);
}
