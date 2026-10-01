#!/usr/bin/env node
/**
 * Zero-dependency build: strips TypeScript types with Node's built-in `module.stripTypeScriptTypes`
 * (Node ≥ 22.13), converts the ES modules into a tiny in-file module registry, and inlines CSS + JS into ONE
 * self-contained HTML file that opens from disk (file://) with no server and no network access.
 *
 *   node scripts/build.mjs          → demo/dist/index.html and ../CourtKo-Demo.html
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import module from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src', 'main.ts');
const strip = module.stripTypeScriptTypes;
if (typeof strip !== 'function') {
  console.error('This build needs Node 22.13+ (module.stripTypeScriptTypes).');
  process.exit(1);
}

const modules = new Map(); // id -> code
const IMPORT_RE = /^import\s+(?:type\s+)?((?:(?!^import\b)[\s\S])*?)\s+from\s+['"](\.[^'"]+)['"];?[ \t]*$/gm;
const SIDE_IMPORT_RE = /^import\s+['"](\.[^'"]+)['"];?\s*$/gm;

function idOf(file) {
  return relative(root, file).replace(/\\/g, '/');
}

function transform(file) {
  const id = idOf(file);
  if (modules.has(id)) return;
  modules.set(id, '');
  let src = readFileSync(file, 'utf8');
  src = strip(src, { mode: 'strip' });
  const deps = [];
  const resolveDep = (spec) => {
    const target = resolve(dirname(file), spec);
    deps.push(target);
    return idOf(target);
  };
  const exported = [];
  // side-effect imports first, then named/namespace imports
  src = src.replace(SIDE_IMPORT_RE, (_m, spec) => `__req(${JSON.stringify(resolveDep(spec))});`);
  src = src.replace(IMPORT_RE, (_m, clause, spec) => {
    const depId = resolveDep(spec);
    clause = clause.trim();
    if (!clause) return `__req(${JSON.stringify(depId)});`;
    if (clause.startsWith('* as ')) return `const ${clause.slice(5).trim()} = __req(${JSON.stringify(depId)});`;
    if (clause.startsWith('{')) {
      const names = clause
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [a, b] = s.split(/\s+as\s+/);
          return b ? `${a}: ${b}` : a;
        });
      return names.length ? `const { ${names.join(', ')} } = __req(${JSON.stringify(depId)});` : `__req(${JSON.stringify(depId)});`;
    }
    throw new Error(`Unsupported import in ${id}: ${clause}`);
  });
  // re-exports like `export { a, b };`
  src = src.replace(/^export\s*\{([^}]*)\};?\s*$/gm, (_m, list) => {
    for (const part of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [a, b] = part.split(/\s+as\s+/);
      exported.push([b ?? a, a]);
    }
    return '';
  });
  // export declarations
  src = src.replace(/^export\s+(async\s+function|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => {
    exported.push([name, name]);
    return `${kind} ${name}`;
  });
  if (/^export\s/m.test(src)) {
    const line = src.split('\n').find((l) => /^export\s/.test(l));
    throw new Error(`Unsupported export in ${id}: ${line}`);
  }
  const tail = exported.map(([pub, local]) => `Object.defineProperty(exports, ${JSON.stringify(pub)}, { enumerable: true, get: () => ${local} });`).join('\n');
  modules.set(id, `${src}\n${tail}`);
  for (const d of deps) transform(d);
}

transform(entry);

const registry = [...modules.entries()]
  .map(([id, code]) => `__def(${JSON.stringify(id)}, function (exports, __req) {\n${code}\n});`)
  .join('\n');

const runtime = `(function () {
'use strict';
var __defs = Object.create(null), __cache = Object.create(null);
function __def(id, fn) { __defs[id] = fn; }
function __req(id) {
  if (__cache[id]) return __cache[id];
  var exports = {}; __cache[id] = exports;
  if (!__defs[id]) throw new Error('Module not found: ' + id);
  __defs[id](exports, __req);
  return exports;
}
${registry}
__req(${JSON.stringify(idOf(entry))});
})();`;

const css = readFileSync(join(root, 'styles', 'app.css'), 'utf8');
const buildId = new Date().toISOString();
const faviconSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%230F7A5A'/><rect x='6' y='8' width='20' height='16' rx='2' fill='none' stroke='%23C8F169' stroke-width='2'/><path d='M16 8v16' stroke='%23C8F169' stroke-width='1.6'/><circle cx='22.5' cy='10.5' r='3.2' fill='%23C8F169'/></svg>`;
const htmlOut = `<!doctype html>
<html lang="en-PH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="CourtKo — book pickleball courts across the Philippines. Interactive demo with synthetic data.">
<meta name="theme-color" content="#0B3B2E">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>CourtKo · Interactive demo</title>
<link rel="icon" href="data:image/svg+xml,${faviconSvg}">
<style>${css}</style>
</head>
<body>
<a class="sr-only" href="#main">Skip to content</a>
<div id="app"><div class="splash"><strong style="font-size:1.4rem">CourtKo</strong><div class="bar"><span></span></div><span style="opacity:.8">Preparing synthetic demo data…</span></div></div>
<dialog id="modal" class="modal" aria-modal="true"></dialog>
<div id="toast-root" aria-live="polite"></div>
<div id="presenter-root"></div>
<noscript><p style="padding:24px;font-family:sans-serif">This interactive demo needs JavaScript enabled.</p></noscript>
<script>/* build ${buildId} */
${runtime}
</script>
</body>
</html>
`;

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), htmlOut);
const rootCopy = join(root, '..', 'CourtKo-Demo.html');
writeFileSync(rootCopy, htmlOut);
console.log(`Built ${modules.size} modules → dist/index.html and ${relative(process.cwd(), rootCopy) || rootCopy} (${(htmlOut.length / 1024).toFixed(0)} KB)`);
if (!existsSync(rootCopy)) process.exit(1);
