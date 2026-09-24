// Bundles the game into a single self-contained HTML file.
//   dist/index.html     full document (GitHub Pages, or open straight from disk)
//   dist/fragment.html  same page without <html>/<head>/<body>, for hosts that supply the skeleton
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';

const minify = !process.argv.includes('--dev');

async function bundle(entry, format) {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    format,
    minify,
    write: false,
    target: ['es2020'],
    legalComments: 'none',
    logLevel: 'warning',
  });
  return r.outputFiles[0].text;
}

const workerSrc = await bundle('src/world/worker.js', 'iife');
const mainSrc = await bundle('src/main.js', 'esm');
const css = await readFile('styles.css', 'utf8');
const html = await readFile('index.html', 'utf8');

const section = (name) => {
  const m = html.match(new RegExp(`<!--${name}-->([\\s\\S]*?)<!--/${name}-->`));
  if (!m) throw new Error('index.html is missing the ' + name + ' markers');
  return m[1];
};

// keep "</script>" sequences in the payload from closing the inline tag
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const workerTag = `<script>globalThis.__LUMEN_WORKER_SRC__ = ${safe(JSON.stringify(workerSrc))};</script>`;
const mainTag = `<script type="module">${safe(mainSrc)}</script>`;
const styleTag = `<style>${css}</style>`;

const full = html
  .replace(/<!--STYLES-->[\s\S]*?<!--\/STYLES-->/, () => styleTag)
  .replace(/<!--SCRIPT-->[\s\S]*?<!--\/SCRIPT-->/, () => workerTag + '\n' + mainTag);

const title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
const fragment = [title, section('FONTS').trim(), styleTag, section('BODY').trim(), workerTag, mainTag].join('\n');

await mkdir('dist/icons', { recursive: true });
await writeFile('dist/index.html', full);
// installable web app: manifest and icons next to the page
for (const f of ['manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png']) {
  await copyFile(f, 'dist/' + f);
}
await writeFile('dist/fragment.html', fragment);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB';
console.log(`dist/index.html ${kb(full)}  (game ${kb(mainSrc)}, worker ${kb(workerSrc)})`);
console.log(`dist/fragment.html ${kb(fragment)}`);
