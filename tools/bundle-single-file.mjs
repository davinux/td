#!/usr/bin/env node
// Build a single-file copy of the game that runs without a web server.
//
// The default layout (index.html + js/ + data/ + vendor/) stays as-is for
// development. This script bundles everything into one self-contained HTML
// file you can double-click (file://), where ES module loading and fetch()
// of data files would otherwise be blocked:
//
//   - all js/ modules are concatenated into one classic <script>: static
//     imports are resolved, the dynamic import()s are rewired, and
//     duplicate top-level names are renamed. Everything shares one scope,
//     so live bindings (export let ...) keep working;
//   - vendor/three.module.js is inlined into a namespace object;
//   - data/*.json is inlined behind a tiny fetch() shim;
//   - style.css is inlined and the favicon becomes a data: URI.
//
// Usage:
//   node tools/bundle-single-file.mjs [--out dist/tfgame-standalone.html] [--keep-js] [--smoke]
//
//   --keep-js  also write the assembled bundle as dist/bundle.js (debugging)
//   --smoke    boot the bundle in Node with DOM stubs to catch linker errors

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = join(ROOT, 'js');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);
const OUT = opt('--out', 'dist/tfgame-standalone.html');

// ---------------------------------------------------------------------------
// 1. Masking: blank comments / string literals / template text (keeping
// ${...} expressions as code) so every later regex only sees real code.
// The mask is length-identical, so spans transfer to the original source.
// ---------------------------------------------------------------------------
function maskJs(src) {
  const out = src.split(''); // UTF-16 units: blanking keeps length identical (Array.from would merge surrogate pairs)
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < Math.min(b, n); k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const skipString = (i) => {
    const q = src[i];
    let j = i + 1;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === q) return j + 1;
      j++;
    }
    return j;
  };
  function scanTemplate(i) {
    let j = i + 1, seg = j;
    while (j < n) {
      const c = src[j];
      if (c === '\\') { j += 2; continue; }
      if (c === '`') { blank(seg, j); return j + 1; }
      if (c === '$' && src[j + 1] === '{') {
        blank(seg, j);
        j = scanExpr(j + 2);
        seg = j;
        continue;
      }
      j++;
    }
    return j;
  }
  function scanExpr(i) {
    let j = i, depth = 1;
    while (j < n && depth > 0) {
      const c = src[j];
      if (c === '"' || c === "'") { j = skipString(j); continue; }
      if (c === '`') { j = scanTemplate(j); continue; }
      if (c === '/' && src[j + 1] === '/') {
        let k = j;
        while (k < n && src[k] !== '\n') k++;
        blank(j, k); j = k; continue;
      }
      if (c === '/' && src[j + 1] === '*') {
        let k = src.indexOf('*/', j + 2);
        k = k < 0 ? n : k + 2;
        blank(j, k); j = k; continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    return j;
  }
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j;
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j); i = j;
    } else if (c === '"' || c === "'") {
      const j = skipString(i);
      blank(i, j); i = j;
    } else if (c === '`') {
      i = scanTemplate(i);
    } else {
      i++;
    }
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// 2. Parse every game module (imports / exports / top-level declarations).
// ---------------------------------------------------------------------------
const JS_FILES = ['art3d.js', 'audio.js', 'codex.js', 'content.js', 'editor.js',
  'editor3d.js', 'enemies3d.js', 'fx3d.js', 'game.js', 'generator.js', 'graphics.js',
  'hud3d.js', 'icons.js', 'levels.js', 'main.js', 'mapgen.js', 'menu3d.js', 'model.js',
  'showroom.js', 'storage.js', 'terrain3d.js', 'tooltip.js', 'towers3d.js',
  'towersvg.js', 'uiicons.js', 'view3d.js'];

const srcOf = {};
const maskOf = {};
for (const f of JS_FILES) {
  srcOf[f] = read(`js/${f}`);
  maskOf[f] = maskJs(srcOf[f]);
  if (/\bimport\.meta\b/.test(maskOf[f])) throw new Error(`${f}: import.meta not supported by the bundler`);
  if (/(^|;|\s)export\s+default\b/.test(maskOf[f])) throw new Error(`${f}: export default not supported by the bundler`);
}

function fileOf(spec) {
  if (!spec.startsWith('./')) throw new Error(`non-relative import: ${spec}`);
  return spec.slice(2);
}

// entries: "a" | "a as b"  -> [{ imported, local }]
function splitList(list) {
  return list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (!m) throw new Error(`cannot parse export/import entry: ${s}`);
    return { imported: m[1], local: m[2] || m[1] };
  });
}

const mods = {}; // f -> { imports:[{local, imported, file}], reexportFrom, exportsOwn:[names], exportList:[{exported, local}], dynImports:[...] }
for (const f of JS_FILES) {
  const src = srcOf[f], masked = maskOf[f];
  const m = { file: f, imports: [], reexportFrom: null, exportsOwn: [], exportList: [], dynSpans: [] };
  // static imports (matched on masked code; path read from original at same offset)
  const re = /import\s*\{([^}]*)\}\s*from\b/g;
  let mm;
  while ((mm = re.exec(masked))) {
    if (process.env.BUNDLE_DEBUG) console.error(`IMPORT-MATCH ${f} @${mm.index}: ${JSON.stringify(mm[0])}`);
    if (masked.slice(mm.index, mm.index + 6) !== 'import') continue;
    const after = src.slice(mm.index + mm[0].length);
    const pm = after.match(/^\s*(['"])([^'"]+)\1/);
    if (!pm) throw new Error(`${f}: cannot parse import path after: ${mm[0]}`);
    const file = fileOf(pm[2]);
    for (const e of splitList(mm[1])) m.imports.push({ ...e, file, start: mm.index, end: mm.index + mm[0].length + pm[0].length });
  }
  if (/^\s*import\s*['"]/.test(masked)) throw new Error(`${f}: side-effect import not supported`);
  // export { a } from './x.js'
  const re2 = /export\s*\{([^}]*)\}\s*from\b/g;
  while ((mm = re2.exec(masked))) {
    if (m.reexportFrom) throw new Error(`${f}: multiple re-export-from statements`);
    const after = src.slice(mm.index + mm[0].length);
    const pm = after.match(/^\s*(['"])([^'"]+)\1/);
    if (!pm) throw new Error(`${f}: cannot parse re-export path`);
    m.reexportFrom = { entries: splitList(mm[1]), file: fileOf(pm[2]), start: mm.index, end: mm.index + mm[0].length + pm[0].length };
  }
  // export { a, b } (local names)
  const re3 = /export\s*\{([^}]*)\}\s*;?/g;
  while ((mm = re3.exec(masked))) {
    if (m.reexportFrom && mm.index === m.reexportFrom.start) continue;
    m.exportList.push(...splitList(mm[1]).map((e) => ({ ...e, start: mm.index, end: mm.index + mm[0].length })));
  }
  // export function/const/let/var/class (+ async function)
  const re4 = /^(export\s+)?(async\s+function|function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  while ((mm = re4.exec(masked))) {
    m.exportsOwn.push({ kind: mm[2], name: mm[3], start: mm.index, exportLen: mm[1] ? mm[1].length : 0 });
  }
  // dynamic import(...)
  const re5 = /import\s*\(/g;
  while ((mm = re5.exec(masked))) {
    m.dynSpans.push(mm.index);
  }
  mods[f] = m;
}

// static dependency edges (for ordering)
const deps = {};
for (const f of JS_FILES) {
  const s = new Set();
  for (const im of mods[f].imports) s.add(im.file);
  if (mods[f].reexportFrom) s.add(mods[f].reexportFrom.file);
  deps[f] = [...s].filter((d) => mods[d]);
  for (const d of deps[f]) {
    if (!mods[d]) throw new Error(`${f} imports unknown file ${d}`);
  }
}
// topological order (alphabetical tiebreak => deterministic)
const order = [];
{
  const indeg = {};
  for (const f of JS_FILES) indeg[f] = 0;
  for (const f of JS_FILES) for (const d of deps[f]) indeg[f]++;
  const ready = JS_FILES.filter((f) => indeg[f] === 0).sort();
  while (ready.length) {
    const f = ready.shift();
    order.push(f);
    for (const g of JS_FILES) {
      if (deps[g].includes(f)) {
        indeg[g]--;
        if (indeg[g] === 0) { ready.push(g); ready.sort(); }
      }
    }
  }
  if (order.length !== JS_FILES.length) throw new Error('circular dependency between game modules');
}

// ---------------------------------------------------------------------------
// 3. Claim global names; resolve every import to its final binding.
// ---------------------------------------------------------------------------
const tag = (f) => basename(f, '.js');
const finalOf = {};   // "file:name" -> final global name (for declarations)
const exportMap = {}; // "file:exportedName" -> "originFile:originName"
const claimedBy = {}; // global name -> "file:name"
for (const f of order) {
  const m = mods[f];
  // re-export-from aliases resolve straight to the origin file
  if (m.reexportFrom) {
    for (const e of m.reexportFrom.entries) {
      exportMap[`${f}:${e.local}`] = `${m.reexportFrom.file}:${e.imported}`;
    }
  }
  for (const d of m.exportsOwn) {
    const key = `${f}:${d.name}`;
    let fin = d.name;
    if (claimedBy[fin] && claimedBy[fin] !== key) fin = `${d.name}__${tag(f)}`;
    claimedBy[fin] = key;
    finalOf[key] = fin;
  }
  for (const e of m.exportList) {
    // local re-export: find the local binding (must be an import or own decl)
    const imp = m.imports.find((i) => i.local === e.imported);
    if (imp) exportMap[`${f}:${e.local}`] = `${imp.file}:${imp.imported}`;
    else exportMap[`${f}:${e.local}`] = `${f}:${e.imported}`;
  }
  for (const d of m.exportsOwn) {
    if (!(exportMap[`${f}:${d.name}`])) exportMap[`${f}:${d.name}`] = `${f}:${d.name}`;
  }
}
function resolveExport(file, name, seen = []) {
  const key = `${file}:${name}`;
  if (seen.includes(key)) throw new Error(`re-export cycle at ${key}`);
  const next = exportMap[key];
  if (!next) throw new Error(`${file} does not export ${name}`);
  if (next === key) {
    if (!finalOf[key]) throw new Error(`no binding for ${key}`);
    return finalOf[key];
  }
  const [nf, nn] = next.split(':');
  return resolveExport(nf, nn, [...seen, key]);
}

// ---------------------------------------------------------------------------
// 4. Rewrite each module: drop imports/exports, apply renames, rewire import().
// ---------------------------------------------------------------------------
const DYN_THREE = '__THREE';

function wordEdits(masked, oldName, newName, skipSpans) {
  const edits = [];
  const re = new RegExp(`(?<![\\w$.])${oldName}(?![\\w$])`, 'g');
  let mm;
  while ((mm = re.exec(masked))) {
    if (skipSpans.some(([a, b]) => mm.index >= a && mm.index < b)) continue;
    edits.push({ start: mm.index, end: mm.index + oldName.length, text: newName });
  }
  return edits;
}

function applyEdits(src, edits, where = '') {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (i + 1 < sorted.length && sorted[i + 1].end > e.start) {
      const o = sorted[i + 1];
      throw new Error(`overlapping edits in ${where} at offset ${e.start}: [${o.start},${o.end}) ${JSON.stringify(o.text.slice(0, 40))} vs [${e.start},${e.end}) ${JSON.stringify(e.text.slice(0, 40))} :: ${JSON.stringify(src.slice(Math.max(0, e.start - 60), e.end + 60))}`);
    }
    src = src.slice(0, e.start) + e.text + src.slice(e.end);
  }
  return src;
}

const chunks = [];
const renameReport = [];
// dynamic import() rewiring targets (namespaces emitted after their module)
const DYN_FILES = ['view3d.js', 'hud3d.js'];
for (const f of order) {
  const m = mods[f];
  const src = srcOf[f], masked = maskOf[f];
  const edits = [];
  const skipSpans = [];
  const delSpan = (start, end) => {
    // several import names share one statement span — delete it only once
    if (skipSpans.some(([a, b]) => a === start && b === end)) return;
    edits.push({ start, end, text: '' });
    skipSpans.push([start, end]);
  };
  // a. delete static import statements
  for (const im of m.imports) delSpan(im.start, im.end);
  // b. delete re-export-from / local export-list statements
  if (m.reexportFrom) delSpan(m.reexportFrom.start, m.reexportFrom.end);
  for (const e of m.exportList) delSpan(e.start, e.end);
  // c. strip `export ` prefixes on declarations
  for (const d of m.exportsOwn) {
    if (d.exportLen > 0) edits.push({ start: d.start, end: d.start + d.exportLen, text: '' });
  }
  // d. renames: own declarations + import locals resolving elsewhere
  const renames = new Map(); // oldLocal -> finalName
  for (const d of m.exportsOwn) {
    const fin = finalOf[`${f}:${d.name}`];
    if (fin !== d.name) renames.set(d.name, fin);
  }
  for (const im of m.imports) {
    const fin = resolveExport(im.file, im.imported);
    if (fin !== im.local) renames.set(im.local, fin);
  }
  for (const [oldName, newName] of renames) {
    const found = wordEdits(masked, oldName, newName, skipSpans);
    edits.push(...found);
    renameReport.push(`${f}: ${oldName} -> ${newName} (${found.length} uses)`);
  }
  // e. rewire dynamic import() (same coordinate space: applied in this pass)
  for (const idx of m.dynSpans) {
    const rest = src.slice(idx);
    const pm = rest.match(/^import\s*\(\s*([^)]+?)\s*\)/);
    if (!pm) throw new Error(`${f}: cannot parse dynamic import`);
    const arg = pm[1];
    let replacement;
    if (/^THREE_URL$/.test(arg)) {
      replacement = `Promise.resolve(${DYN_THREE})`;
    } else {
      const sm = arg.match(/^(['"])([^'"]+)\1$/);
      if (!sm) throw new Error(`${f}: non-literal dynamic import: ${arg}`);
      const target = fileOf(sm[2]);
      if (!DYN_FILES.includes(target)) throw new Error(`${f}: dynamic import of ${target} not supported`);
      replacement = `Promise.resolve(__dyn_${tag(target)})`;
    }
    edits.push({ start: idx, end: idx + pm[0].length, text: replacement });
  }
  let code = applyEdits(src, edits, f);
  chunks.push({ file: f, code });
}

// dynamic import() namespaces, emitted right after their module's chunk
{
  // view3d / hud3d namespaces expose their exported names
  for (const f of DYN_FILES) {
    const names = new Set();
    for (const key of Object.keys(exportMap)) {
      const [ef] = key.split(':');
      if (ef === f) names.add(key.slice(ef.length + 1));
    }
    const entries = [...names].map((n) => `${n}: ${resolveExport(f, n)}`).join(', ');
    chunks.push({ file: `__dyn:${f}`, code: `const __dyn_${tag(f)} = { ${entries} };` });
  }
}

// ---------------------------------------------------------------------------
// 5. Inline vendor/three.module.js (self-contained, single export statement).
// ---------------------------------------------------------------------------
let threeBody, threeNames;
{
  const raw = read('vendor/three.module.js');
  // line-anchored on purpose: the generic masker cannot tell regex literals
  // (which may contain quotes) apart from strings in this 1.2 MB file, and
  // the vendored build is known to carry exactly one top-level export list.
  if ((raw.match(/^export /gm) || []).length !== 1) {
    throw new Error('vendor/three.module.js: expected exactly one top-level export statement');
  }
  const em = raw.match(/^export \{([^}]*)\};?\s*$/m);
  if (!em) throw new Error('vendor/three.module.js: export list not found');
  threeNames = splitList(em[1]);
  threeBody = raw.slice(0, em.index) + raw.slice(em.index + em[0].length);
}
const threeChunk = `const ${DYN_THREE} = (() => {\n${threeBody}\nreturn { ${threeNames.map((e) => (e.imported === e.local ? e.local : `${e.local}: ${e.imported}`)).join(', ')} };\n})();`;

// ---------------------------------------------------------------------------
// 6. Inline data/*.json behind a fetch() shim (file:// has no fetch to disk).
// ---------------------------------------------------------------------------
const INLINE_DATA = {
  'data/towers.json': JSON.parse(read('data/towers.json')),
  'data/enemies.json': JSON.parse(read('data/enemies.json')),
  'data/campaign.json': JSON.parse(read('data/campaign.json')),
};
const shimChunk = `// file:// fetch() shim: data/*.json is inlined below (no web server needed).
const __INLINE_DATA = ${JSON.stringify(INLINE_DATA)};
const __INLINE_LOG = (globalThis.__INLINE_LOG = []);
{
  const __origFetch = globalThis.fetch && globalThis.fetch.bind(globalThis);
  globalThis.fetch = function (input, init) {
    let key = '';
    try {
      key = typeof input === 'string' ? input : (input && input.url) || '';
    } catch { key = ''; }
    if (key && Object.prototype.hasOwnProperty.call(__INLINE_DATA, key)) {
      __INLINE_LOG.push(key);
      return Promise.resolve(new Response(JSON.stringify(__INLINE_DATA[key]), {
        headers: { 'Content-Type': 'application/json' },
      }));
    }
    return __origFetch(input, init);
  };
}`;

// ---------------------------------------------------------------------------
// 7. Assemble the bundle + the single HTML file.
// ---------------------------------------------------------------------------
const bundleParts = [
  '// tfgame standalone bundle (generated by tools/bundle-single-file.mjs — do not edit).',
  shimChunk,
  `// ---- vendor/three.module.js (inlined) ----\n${threeChunk}`,
  ...chunks.map((c) => `// ---- js/${c.file} ----\n${c.code}`),
];
const bundleJs = bundleParts.join('\n\n');

// static sanity checks on the finished bundle (comments/strings masked)
{
  const masked = maskJs(bundleJs);
  const bad = [
    [/^\s*import[\s{(]/m, 'leftover static import'],
    [/\bexport\s+(async\s+function|function|const|let|var|class|\{)/, 'leftover export'],
    [/\bimport\s*\(/, 'leftover dynamic import'],
    [/from\s*['"]\.\//, 'leftover relative import path'],
  ];
  for (const [re, what] of bad) {
    if (re.test(masked)) throw new Error(`bundle check failed: ${what}`);
  }
  for (const needle of ['createView3D', 'createHud3D', 'initGame', DYN_THREE]) {
    if (!bundleJs.includes(needle)) throw new Error(`bundle check failed: ${needle} missing`);
  }
  for (const needle of ['</script', '<!--']) {
    if (bundleJs.includes(needle)) throw new Error(`bundle check failed: ${needle} would break inline <script>`);
  }
}

let html = read('index.html');
const css = read('style.css');
html = html.replace(
  '<link rel="stylesheet" href="style.css" />',
  () => `<!-- standalone: style.css inlined -->\n<style>\n${css}\n</style>`,
);
if (!html.includes('<style>')) throw new Error('stylesheet link not found in index.html');
html = html.replace(
  '<script type="module" src="js/main.js"></script>',
  () => `<!-- standalone: all of js/ + vendor/ inlined below -->\n<script>\n${bundleJs}\n</script>`,
);
if (!html.includes(bundleJs.slice(0, 64))) throw new Error('main script tag not found in index.html');
// manifest + loose icon files cannot load over file:// — drop them, keep a data: favicon
html = html.replace(/^\s*<link rel="manifest"[^>]*>\n?/m, '');
html = html.replace(/^\s*<link rel="(icon|apple-touch-icon)"[^>]*>\n?/gm, '');
if (/rel="(manifest|icon|apple-touch-icon)"/.test(html)) throw new Error('icon/manifest links remain');
const favicon = readFileSync(join(ROOT, 'icons/icon-192.png')).toString('base64');
html = html.replace(
  '</title>',
  () => `</title>\n<link rel="icon" type="image/png" href="data:image/png;base64,${favicon}" />`,
);

mkdirSync(dirname(join(ROOT, OUT)), { recursive: true });
writeFileSync(join(ROOT, OUT), html);
console.log(`wrote ${OUT} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
if (flag('--keep-js')) {
  writeFileSync(join(ROOT, 'dist/bundle.js'), bundleJs);
  console.log('wrote dist/bundle.js');
}
if (renameReport.length) {
  console.log(`renames (${renameReport.length}):`);
  for (const r of renameReport) console.log(`  ${r}`);
}

// ---------------------------------------------------------------------------
// 8. Optional smoke test: boot the bundle in Node with DOM stubs.
// ---------------------------------------------------------------------------
if (flag('--smoke')) {
  const vm = await import('node:vm');
  const rejections = [];
  const onRej = (e) => rejections.push(e);
  process.on('unhandledRejection', onRej);

  const anyProxy = () =>
    new Proxy(function () {}, {
      get(t, p) {
        if (p === Symbol.toPrimitive) return (hint) => (hint === 'string' ? '' : 0);
        if (p === Symbol.iterator) return function* () {};
        if (p === 'measureText') return () => ({ width: 0 });
        if (p === 'length') return 0;
        return proxy;
      },
      set: () => true,
      apply: () => proxy,
    });
  var proxy;
  const mkProxy = () => (proxy = anyProxy());
  const mkEl = (tag) => ({
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    width: 640,
    height: 480,
    clientWidth: 800,
    clientHeight: 600,
    offsetHeight: 0,
    offsetWidth: 0,
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    removeChild(c) { return c; },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    blur() {},
    click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    getContext: () => mkProxy(),
    setPointerCapture() {},
    releasePointerCapture() {},
    scrollIntoView() {},
  });
  const ids = new Map();
  const store = new Map();
  const sandbox = {
    console,
    performance,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Response,
    fetch: () => Promise.reject(new Error('network disabled in smoke test')),
    localStorage: {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => store.set(String(k), String(v)),
      removeItem: (k) => store.delete(String(k)),
      clear: () => store.clear(),
    },
    navigator: {},
    location: { hash: '', pathname: '/', search: '' },
    history: { pushState() {}, replaceState() {} },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    document: {
      getElementById: (id) => {
        if (!ids.has(id)) ids.set(id, mkEl('div'));
        return ids.get(id);
      },
      createElement: (t) => mkEl(t),
      createElementNS: (ns, t) => mkEl(t),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      body: mkEl('body'),
      documentElement: mkEl('html'),
      activeElement: null,
      title: '',
    },
  };
  sandbox.window = {
    addEventListener() {},
    removeEventListener() {},
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 800,
    AudioContext: undefined,
    localStorage: sandbox.localStorage,
  };
  sandbox.self = sandbox.window;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(bundleJs, sandbox, { filename: 'bundle.js' });
    // let boot promises (loadContent/loadCampaign/initGame) settle
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 25));
    const log = sandbox.__INLINE_LOG || [];
    for (const k of ['data/towers.json', 'data/enemies.json', 'data/campaign.json']) {
      if (!log.includes(k)) throw new Error(`smoke: ${k} was never fetched (data shim unused?)`);
    }
    if (rejections.length) throw new Error(`smoke: ${rejections.length} unhandled rejection(s): ${rejections[0] && rejections[0].message}`);
    console.log('smoke: boot OK, data shim served towers/enemies/campaign, no unhandled rejections');
  } finally {
    process.off('unhandledRejection', onRej);
  }
}
