/* 薄肌系统 · 内容清单（Content Manifest）——「内容零丢失」的机器验证基准
 *
 * 用途：迁移前从源文件提取一份内容指纹，迁移后从新文件提取同格式清单，
 *       逐条比对。任何一条内容缺失/被改写都会在比对中暴露。
 *
 * 覆盖范围（= 用户所说的「内容」）：
 *   ① 内容资产 KbData：LIBRARY / SUPPLEMENTS / HERBS / RELEASE / LONGEVITY /
 *      SKINCARE / FOODS / PLAN / DATA
 *   ② 术语表 GLOSSARY
 *   ③ 配置：Diet.TARGET / Library.CATS / 各模块分级轴
 *   ④ 文本体量统计（字符数），防止「条目在但文案被删」
 *
 * 只读，不修改任何文件。
 * 用法：node content-manifest.js <index.html> [out.json]
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const SRC = process.argv[2];
const OUT = process.argv[3];
if (!SRC) { console.error('用法: node content-manifest.js <index.html> [out.json]'); process.exit(2); }
const src = fs.readFileSync(SRC, 'utf8');

/* ---------- 1. 定位并加载逻辑层 ----------
 * 锚点必须用**代码 token**，不能用注释：
 *   迁移会整体重写 UI 层，注释分隔符会被改掉，而这支工具必须跨越迁移前后都能跑。
 *   `const KbData = (function(){` 与 `const UI = (function(){` 是模块变量声明，
 *   无论 UI 怎么重写都必然存在，因此用它俩夹出「逻辑层」这一段。
 *   SwipeTab 位于 UI 之前但它只是定义函数、不在求值时碰 DOM，包含进来无害。
 */
const ANCHOR = 'const KbData = (function(){';
const BOUNDARY = 'const UI = (function(){';

function locateLogic(src) {
  const b = src.indexOf(BOUNDARY);
  if (b < 0) throw new Error('未找到逻辑层右边界 `' + BOUNDARY + '`');
  const a = src.lastIndexOf(ANCHOR, b);
  if (a < 0) throw new Error('未找到逻辑层左锚点 `' + ANCHOR + '`');
  /* 从锚点所在的 <script> 块体起点开始（Util 定义在 KbData 之前，必须一并纳入） */
  const ps = src.lastIndexOf('<script', a);
  const body = src.indexOf('>', ps) + 1;
  return { start: body, end: b };
}
const { start: s0, end: logicEnd } = locateLogic(src);
const logic = src.slice(s0, logicEnd);

const noop = () => {};
const store = {};
const mql = { matches: false, addEventListener: noop, removeEventListener: noop };
const sb = {
  console: { log: noop, warn: noop, error: noop, info: noop },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: noop,
    get length() { return 0; }, key: () => null,
  },
  window: { matchMedia: () => mql, addEventListener: noop, removeEventListener: noop, location: { hash: '' } },
  document: {
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    documentElement: { setAttribute: noop, getAttribute: () => 'dark' },
  },
  navigator: { maxTouchPoints: 0 }, matchMedia: () => mql,
  requestAnimationFrame: f => setTimeout(f, 0),
  setTimeout, clearTimeout,
  Date, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error,
  Map, Set, Promise, isNaN, parseInt, parseFloat,
};
sb.globalThis = sb;
const ctx = vm.createContext(sb);
vm.runInContext(
  logic + '\n;globalThis.__M = {\n' +
  '  LIBRARY: KbData.LIBRARY, SUPPLEMENTS: KbData.SUPPLEMENTS, HERBS: KbData.HERBS,\n' +
  '  RELEASE: KbData.RELEASE, LONGEVITY: KbData.LONGEVITY, SKINCARE: KbData.SKINCARE,\n' +
  '  FOODS: KbData.FOODS, PLAN: KbData.PLAN, DATA: KbData.DATA,\n' +
  '  TARGET: Diet.TARGET, CATS: Library.CATS,\n' +
  '  TIERS: Supplements.TIERS, HTYPES: Herbs.TYPES, RTYPES: Release.TYPES,\n' +
  '  LTYPES: Longevity.TYPES, STIERS: Skin.TIERS,\n' +
  '  GLOSSARY: (typeof GLOSSARY !== "undefined" ? GLOSSARY : null)\n' +
  '};', ctx);
const M = sb.__M;

/* ---------- 2. 指纹工具 ---------- */
/* 稳定序列化：键排序，保证同一内容在任何提取顺序下哈希一致 */
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const h = v => crypto.createHash('sha256').update(stable(v)).digest('hex').slice(0, 16);

/* 统计一段内容里的文本体量（字符串字符数 + 字符串个数），
   防止「条目还在但文案被清空」这种隐性丢失 */
function textVolume(v) {
  let chars = 0, strings = 0;
  (function walk(x) {
    if (typeof x === 'string') { chars += x.length; strings++; return; }
    if (Array.isArray(x)) return x.forEach(walk);
    if (x && typeof x === 'object') return Object.keys(x).forEach(k => walk(x[k]));
  })(v);
  return { chars, strings };
}

/* ---------- 1b. 采集「藏在 UI 模块内部的内容」----------
 * ⚠️ 这是本工具存在的最重要理由：
 *   以下两类东西定义在 UI 模块内部，按「UI 层整体废弃」粗放处理会被误删。
 *   ① GLOSSARY（术语表）—— 纯内容，2,980 字符，必须原样保留
 *   ② KB_* 的字段命名体系 —— 渲染描述符内嵌的中文标签
 *      （作用/剂量/时机/副作用/禁忌/相互作用/提示），是领域字段词汇表，属内容资产
 * 采集方式：GLOSSARY 需要在逻辑层已加载的沙箱里求值（其文案插值了 DERIVED/TARGET）；
 *           KB_* 含 UI 辅助函数引用无法整体求值，只抽取其中的中文字面量。
 */
/* 切片必须**缩进无关**：迁移会把常量搬进逻辑层并重排格式，
   早先写死 `\n  const`（恰好两空格）会因缩进变化而切错边界，
   产生"内容被改写"的假阳性。这里允许 0-4 空格。 */
function sliceDecl(text, name) {
  const re = new RegExp('const ' + name + '\\s*=');
  const i = text.search(re);
  if (i < 0) return null;
  const rest = text.slice(i);
  const nx = rest.slice(12).match(/\n\s{0,4}(?:const|function)\s+\w/);
  return nx ? rest.slice(0, 12 + nx.index) : rest;
}

/* KB_* 比对改为「去注释 + 折叠空白」后的规范化文本指纹。
   理由：这些声明里既有中文标签也有中文注释，且迁移会重排缩进。
   按字面量正则抽取标签会对缩进与注释敏感 → 假阳性；
   规范化后比对能抓住真实改写，同时忽略纯格式差异。 */
function kbNorm(text, name) {
  const seg = sliceDecl(text, name);
  if (!seg) return null;
  return seg
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const contentConstants = {};
let glossary = null;
/* 迁移后 GLOSSARY 会从 UI 模块搬进逻辑层 → 已在沙箱里声明，直接取用即可。
   重复 `const` 声明会抛 already-declared，早先因此误报"术语表整体缺失"。 */
try {
  glossary = vm.runInContext('typeof GLOSSARY !== "undefined" ? GLOSSARY : null', ctx);
} catch (e) { glossary = null; }
if (!glossary) {
  /* 老结构：GLOSSARY 还留在 UI 模块内，需单独切片求值 */
  try {
    const gsrc = sliceDecl(src, 'GLOSSARY');
    if (gsrc) {
      vm.runInContext(gsrc + '\n;globalThis.__GLOSSARY_OUT = GLOSSARY;', ctx);
      glossary = sb.__GLOSSARY_OUT;
    }
  } catch (e) {
    console.error('⚠ GLOSSARY 求值失败：' + e.message);
  }
}

/* KB_* 字段标签：只取中文字面量，构成「字段命名体系」指纹 */
const kbLabels = {};
for (const name of ['KB_SUPP', 'KB_HERB', 'KB_REL', 'KB_LONG', 'KB_SKIN']) {
  const norm = kbNorm(src, name);
  if (norm === null) { kbLabels[name] = null; continue; }
  /* labels 仍保留（供人工排查），但**比对以 normHash 为准**（注释/缩进无关） */
  const labels = (norm.match(/'([^']*[\u4e00-\u9fff][^']*)'/g) || []).map(x => x.slice(1, -1));
  kbLabels[name] = { hash: h(norm), normHash: h(norm), count: labels.length, labels };
}

/* ---------- 1c. 「内容常量」全量覆盖（修补覆盖盲区）----------
 * ⚠️ 教训：早先只覆盖了 GLOSSARY + KB_*，结果 DS/DS2（8,133 字符的演示数据集）
 *   与 SOLAR_TERMS / CHART_SERIES / DAY_LABELS / OV_MODS / BACKUP_REASON / APP_VERSION
 *   被整体丢掉却没被验收拦下。这里改为**枚举式全量覆盖**：
 *   凡薄肌 UI 模块内的顶层大写常量，一律纳入清单，逐个比对。
 *   唯一豁免 DROPPED_BY_DESIGN —— 这些是「旧导航结构」，迁移中**应当**被新侧栏取代。
 */
const UI_CONSTS = [
  'APP_VERSION', 'TAB_GROUPS', 'TABS', 'GLOSSARY', 'DAY_LABELS', 'OV_MODS',
  'DS2_SRC', 'DS2', 'DS_SRC', 'DS_ATTR', 'DS', 'CHART_SERIES',
  'KB_SUPP', 'KB_HERB', 'KB_REL', 'KB_LONG', 'KB_SKIN',
  'SOLAR_TERMS', 'BACKUP_REASON',
];
/* 有意废弃：其内容就是被替换掉的旧 tab 导航结构，不该保留 */
const DROPPED_BY_DESIGN = ['TABS', 'TAB_GROUPS'];

const uiConsts = {};
for (const name of UI_CONSTS) {
  const norm = kbNorm(src, name);
  if (norm === null) { uiConsts[name] = null; continue; }
  uiConsts[name] = {
    hash: h(norm),
    chars: norm.length,
    droppedByDesign: DROPPED_BY_DESIGN.indexOf(name) >= 0,
  };
}

/* ---------- 3. 生成清单 ---------- */
const manifest = {
  source: SRC,
  generatedAt: new Date().toISOString(),
  collections: {},
  singletons: {},
  config: {},
  glossary: null,
  kbLabels: kbLabels,
  uiConsts: uiConsts,
  totals: { entries: 0, chars: 0, strings: 0 },
};

const COLLECTIONS = ['LIBRARY', 'SUPPLEMENTS', 'HERBS', 'RELEASE', 'LONGEVITY', 'SKINCARE', 'FOODS'];
for (const name of COLLECTIONS) {
  const arr = M[name] || [];
  const vol = textVolume(arr);
  manifest.collections[name] = {
    count: arr.length,
    ids: arr.map(x => (x && x.id) || '(no-id)'),
    hashes: arr.map(x => h(x)),
    chars: vol.chars,
    strings: vol.strings,
    /* 整集合指纹：条目增删改顺序变化都会变 */
    digest: h(arr.map(x => (x && x.id) + ':' + h(x))),
  };
  manifest.totals.entries += arr.length;
  manifest.totals.chars += vol.chars;
  manifest.totals.strings += vol.strings;
}

for (const [name, val] of [['PLAN', M.PLAN], ['DATA', M.DATA]]) {
  const vol = textVolume(val);
  manifest.singletons[name] = {
    keys: val && typeof val === 'object' ? Object.keys(val) : [],
    hash: h(val), chars: vol.chars, strings: vol.strings,
  };
  manifest.totals.chars += vol.chars;
  manifest.totals.strings += vol.strings;
}

manifest.config = {
  TARGET: M.TARGET,
  CATS: M.CATS,
  TIERS: M.TIERS,
  HTYPES: M.HTYPES, RTYPES: M.RTYPES, LTYPES: M.LTYPES, STIERS: M.STIERS,
};

if (glossary) {
  const items = glossary.reduce((a, g) => a.concat(g.items), []);
  const vol = textVolume(glossary);
  manifest.glossary = {
    groups: glossary.map(g => ({ name: g.g, count: g.items.length })),
    total: items.length, hash: h(glossary), chars: vol.chars, strings: vol.strings,
  };
  manifest.totals.chars += vol.chars;
  manifest.totals.strings += vol.strings;
}

manifest.totals.digest = h({
  c: Object.fromEntries(Object.entries(manifest.collections).map(([k, v]) => [k, v.digest])),
  s: Object.fromEntries(Object.entries(manifest.singletons).map(([k, v]) => [k, v.hash])),
  g: manifest.glossary && manifest.glossary.hash,
  kb: kbLabels,
});

/* ---------- 4. 输出 / 比对 ---------- */
const COMPARE = process.env.MANIFEST_COMPARE || process.argv[4];

if (COMPARE) {
  /* ── 验收模式：与基线逐条比对，任何差异都是阻断项 ── */
  const base = JSON.parse(fs.readFileSync(COMPARE, 'utf8'));
  let blocking = 0, checked = 0;
  const fail = (msg) => { blocking++; console.log('  ✗ ' + msg); };
  const ok = (msg) => { checked++; console.log('  ✓ ' + msg); };

  console.log('═══ 内容保真比对（基线 vs 当前）═══');
  console.log('  基线：' + base.source);
  console.log('  当前：' + SRC);
  console.log('');

  for (const name of Object.keys(base.collections)) {
    const b = base.collections[name], c = manifest.collections[name];
    if (!c) { fail(`${name}: 集合整体缺失`); continue; }
    if (b.count !== c.count) fail(`${name}: 条目数 ${b.count} → ${c.count}`);
    else ok(`${name}: ${c.count} 条`);
    const miss = b.ids.filter(id => !c.ids.includes(id));
    if (miss.length) fail(`${name}: 丢失条目 ${miss.slice(0, 6).join(', ')}${miss.length > 6 ? ` …共${miss.length}` : ''}`);
    /* 逐条内容指纹比对（id → hash 对齐，顺序变化不算丢失） */
    const bMap = {}; b.ids.forEach((id, i) => bMap[id] = b.hashes[i]);
    const cMap = {}; c.ids.forEach((id, i) => cMap[id] = c.hashes[i]);
    const changed = Object.keys(bMap).filter(id => cMap[id] && cMap[id] !== bMap[id]);
    if (changed.length) fail(`${name}: 内容被改写 ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? ` …共${changed.length}` : ''}`);
    if (b.chars !== c.chars) fail(`${name}: 文本体量 ${b.chars} → ${c.chars} 字符`);
    if (b.strings !== c.strings) fail(`${name}: 文本段数 ${b.strings} → ${c.strings}`);
  }

  for (const name of Object.keys(base.singletons)) {
    const b = base.singletons[name], c = manifest.singletons[name];
    if (!c) { fail(`${name}: 缺失`); continue; }
    if (b.hash !== c.hash) fail(`${name}: 内容被改写（${b.hash} → ${c.hash}）`);
    else ok(`${name}: 指纹一致`);
    if (b.chars !== c.chars) fail(`${name}: 文本体量 ${b.chars} → ${c.chars} 字符`);
  }

  if (base.glossary) {
    if (!manifest.glossary) fail('GLOSSARY（术语表）: 整体缺失 —— 它在 UI 模块内部，最易被误删');
    else if (base.glossary.hash !== manifest.glossary.hash)
      fail(`GLOSSARY: 内容被改写（${base.glossary.total} 条 → ${manifest.glossary.total} 条）`);
    else ok(`GLOSSARY: ${manifest.glossary.total} 条 · ${manifest.glossary.chars} 字符 一致`);
  }

  /* UI 模块内的内容常量（全量枚举，防覆盖盲区） */
  let lostConsts = [], droppedSeen = [];
  for (const name of Object.keys(base.uiConsts || {})) {
    const b = base.uiConsts[name], c = (manifest.uiConsts || {})[name];
    if (!b) continue;
    if (b.droppedByDesign) { if (!c) droppedSeen.push(name); continue; }
    if (!c) { lostConsts.push(name + '(整体缺失)'); continue; }
    if (b.hash !== c.hash) lostConsts.push(name + '(改写)');
  }
  if (lostConsts.length) fail(`UI 模块内容常量丢失/改写：${lostConsts.join(', ')}`);
  else ok(`UI 模块内容常量 ${Object.keys(base.uiConsts||{}).filter(k=>!base.uiConsts[k].droppedByDesign).length} 项全部一致`);
  if (droppedSeen.length) ok(`有意废弃项已移除：${droppedSeen.join(', ')}`);

  /* KB_* 字段命名体系（藏在 UI 渲染描述符里的领域词汇） */
  for (const name of Object.keys(base.kbLabels || {})) {
    const b = base.kbLabels[name], c = (manifest.kbLabels || {})[name];
    if (!c) { fail(`${name}: 字段标签缺失`); continue; }
    if (b.hash !== c.hash) fail(`${name}: 字段标签被改写（${b.count} 个 → ${c.count} 个）`);
    else ok(`${name}: ${c.count} 个字段标签一致`);
  }

  /* 配置：全等比对（含键顺序无关的稳定序列化） */
  if (stable(base.config) !== stable(manifest.config)) {
    fail('配置项（Diet.TARGET / 分类轴 / 分级轴）被改动');
  } else ok('配置项全部一致');

  console.log('  ' + '─'.repeat(66));
  console.log(`  通过 ${checked} 项 · 阻断 ${blocking} 项`);
  console.log(`  基线指纹 ${base.totals.digest} / 当前指纹 ${manifest.totals.digest}`);
  if (blocking) {
    console.log('\n  结论：内容存在丢失或被改写，不可交付。');
    process.exit(1);
  }
  console.log('\n  结论：内容零丢失。');
  process.exit(0);
}

if (OUT) fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));

console.log('═══ 内容清单（迁移前基线）═══');
for (const [k, v] of Object.entries(manifest.collections)) {
  console.log(`  ${k.padEnd(12)} ${String(v.count).padStart(3)} 条 · 文本 ${String(v.chars).padStart(6)} 字符 / ${String(v.strings).padStart(4)} 段 · digest ${v.digest}`);
}
for (const [k, v] of Object.entries(manifest.singletons)) {
  console.log(`  ${k.padEnd(12)} 对象键 ${v.keys.length} 个 · 文本 ${String(v.chars).padStart(6)} 字符 · hash ${v.hash}`);
}
if (manifest.glossary) {
  console.log(`  ${'GLOSSARY'.padEnd(12)} ${String(manifest.glossary.total).padStart(3)} 条 · 分 ${manifest.glossary.groups.length} 组 · 文本 ${manifest.glossary.chars} 字符 · hash ${manifest.glossary.hash}`);
}
console.log('  ── 以下两项定义在 UI 模块内部，属「易被误删的内容」──');
for (const [k, v] of Object.entries(manifest.kbLabels)) {
  if (v) console.log(`  ${k.padEnd(12)} ${String(v.count).padStart(3)} 个字段标签 · hash ${v.hash}`);
}
console.log('  ' + '─'.repeat(66));
console.log(`  合计：${manifest.totals.entries} 条目 · ${manifest.totals.chars.toLocaleString()} 字符 / ${manifest.totals.strings.toLocaleString()} 段文本`);
console.log(`  内容总指纹：${manifest.totals.digest}`);
if (OUT) console.log(`  已写入：${OUT}`);
