/* 开源脱敏回归：断言「真实内容渲染」，而非仅「页面没报错」。
   覆盖：示例画像注入层 / 派生值文案 / 城市回落 / 硬编码个人数据清零。
   用法：TZ=Asia/Shanghai node tests/verify-privacy.js */
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(P, 'utf8');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  const alt = path.join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules/jsdom');
  ({ JSDOM } = require(alt));
}

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + String(extra).slice(0, 160) : '')); }
}
function section(t) { console.log('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64)); }

/* ---------- S1 源文件层：硬编码个人数据必须清零 ---------- */
section('S1  源文件层 · 硬编码个人数据清零');
const forbidden = [
  ['城市名「深圳」', /深圳/],
  ['旧体重 66.7', /66\.7/],
  ['旧体脂 19.5', /19\.5/],
  ['旧肌肉率 76.3', /76\.3/],
  ['旧基础代谢 1665', /1665/],
  ['旧年龄「29 岁」', /29 ?岁/],
  ['旧蛋白区间 107-147', /107-147/],
  ['旧蛋白区间 130-145', /130-145/],
  ['旧热量缺口 300-500', /300-500/],
  ['舌象基线日期 2026-09-25', /2026-09-25/],
  ['个人爱好「高尔夫」', /高尔夫/],
];
for (const [label, re] of forbidden) {
  ok('index.html 已清除：' + label, !re.test(html));
}
ok('index.html 不含邮箱', !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(html));
ok('index.html 不含疑似手机号', !/\b1[3-9]\d{9}\b/.test(html));
ok('index.html 不含密钥类字段赋值',
   !/(api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}/i.test(html));

section('S2  源文件层 · 注入层已接线');
ok('存在 <script src="profile.local.js">', /<script\s+src="profile\.local\.js"><\/script>/.test(html));
ok('注入脚本位于主脚本之前',
   html.indexOf('<script src="profile.local.js">') < html.lastIndexOf('<script>'));
ok('.gitignore 排除 profile.local.js',
   /^profile\.local\.js$/m.test(fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8')));
ok('示例模板文件已入库', fs.existsSync(path.join(__dirname, '..', 'profile.local.example.js')));

/* ---------- 渲染辅助 ---------- */
function render(beforeParse) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://localhost/',
    pretendToBeVisual: true, beforeParse
  });
  return dom.window;
}
function goto(win, tab) {
  win.document.querySelector('[data-tab="' + tab + '"]').click();
  return win.document.querySelector('#app').textContent;
}

/* ---------- S3 默认（无 profile.local.js）：示例值渲染 ---------- */
section('S3  默认画像 · 示例值真实渲染');
const w1 = render();
const skinText = goto(w1, 'skin');
ok('护肤页渲染出示例年龄与体脂', skinText.indexOf('30 岁、体脂 20%') >= 0,
   skinText.slice(skinText.indexOf('体脂') - 20, skinText.indexOf('体脂') + 20));
ok('护肤页中医视角回落到「湿热地区」', skinText.indexOf('湿热地区夏季湿热') >= 0);
ok('护肤页不再出现「深圳」', skinText.indexOf('深圳') < 0);

const longText = goto(w1, 'longevity');
ok('抗衰页蛋白条目渲染派生区间（70kg → 112-154g）',
   longText.indexOf('112-154g') >= 0,
   (longText.match(/1\.6-2\.2 g\/kg[^，]{0,24}/) || ['(未找到)'])[0]);

/* ---------- S4 注入真实画像：覆盖生效 ---------- */
section('S4  注入 profile.local.js · 覆盖生效');
const w2 = render(win => {
  win.__TM_PROFILE__ = { age: 29, sex: '男', height: 175, weight: 66.7,
                         bodyfat: 19.5, muscleRate: 76.3, city: '示例城市' };
});
const skinText2 = goto(w2, 'skin');
ok('护肤页年龄/体脂随注入画像变化', skinText2.indexOf('29 岁、体脂 19.5%') >= 0);
ok('护肤页城市随注入画像变化', skinText2.indexOf('示例城市夏季湿热') >= 0);
const longText2 = goto(w2, 'longevity');
ok('抗衰页蛋白区间随注入画像变化（66.7kg → 107-147g）',
   longText2.indexOf('107-147g') >= 0,
   (longText2.match(/1\.6-2\.2 g\/kg[^，]{0,24}/) || ['(未找到)'])[0]);

/* ---------- S5 注入缺字段：回落不渲染 null ---------- */
section('S5  画像缺字段 · 回落为中性表述');
const w3 = render(win => { win.__TM_PROFILE__ = { city: '' }; });
const skinText3 = goto(w3, 'skin');
ok('city 留空回落为「湿热地区」', skinText3.indexOf('湿热地区夏季湿热') >= 0);
ok('页面不出现 null/undefined 文案',
   skinText3.indexOf('null') < 0 && skinText3.indexOf('undefined') < 0);

/* ---------- S6 注入层语法正确（可被浏览器执行） ---------- */
section('S6  示例模板可执行且字段完整');
const tpl = fs.readFileSync(path.join(__dirname, '..', 'profile.local.example.js'), 'utf8');
const sandboxWin = {};
sandboxWin.window = sandboxWin;   // 模板以 window.__TM_PROFILE__ 挂载
const vm = require('vm');
vm.createContext(sandboxWin);
let tplErr = null;
try { vm.runInContext(tpl, sandboxWin); } catch (e) { tplErr = e; }
ok('profile.local.example.js 语法正确', !tplErr, tplErr && tplErr.message);
ok('模板定义了 __TM_PROFILE__', !!(sandboxWin.__TM_PROFILE__ && sandboxWin.__TM_PROFILE__.weight));
ok('模板定义了 __TM_TARGETS__', !!(sandboxWin.__TM_TARGETS__ && sandboxWin.__TM_TARGETS__.kcalMin));

/* ---------- S7 入库文件层：文档与配置同步扫描 ----------
   背景：v3.35 曾发生「代码已脱敏、文档漏改」——舌象基线日期残留在系统介绍里。
   本节对全部入库文本文件跑同一套禁用模式，让文档泄漏也能被回归拦截。
   文件清单优先取 git ls-files（精确等于将进入仓库的内容）；
   非 git 环境（如下载 ZIP 后跑测试）退化为目录遍历 + 镜像 .gitignore 的排除规则。 */
section('S7  入库文件层 · 文档与配置同步扫描');
const ROOT = path.join(__dirname, '..');
let tracked = [];
try {
  // core.quotepath=false：否则中文文件名被转义成 "docs/\345\274\200…" 引号串，
  // 既匹配不上 isText 的扩展名规则、也无法用于 readFileSync，会被静默漏扫。
  tracked = require('child_process').execSync('git -c core.quotepath=false ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(Boolean);
} catch (e) { tracked = []; }
if (!tracked.length) {
  const skipDir = new Set(['.git', '.workbuddy', '.codeartsdoer', '.trae-html-share-packages', 'node_modules', 'coverage']);
  const skipFile = f => /(\.bak|\.pre|\.orig|\.zip|\.DS_Store)$/.test(f)
    || /^profile\.local\.(?!example)/.test(f)
    || f === 'docs/系统介绍-v3.28.md';
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) { if (!skipDir.has(ent.name)) walk(path.join(dir, ent.name)); }
      else {
        const rel = path.relative(ROOT, path.join(dir, ent.name));
        if (!skipFile(rel)) tracked.push(rel);
      }
    }
  })(ROOT);
}
const selfRel = path.relative(ROOT, __filename);
const isText = f => /\.(md|html|js|sh|txt)$/i.test(f) || /^(LICENSE|README|\.gitignore)/i.test(path.basename(f)) || f === '.gitignore';
const scanFiles = tracked.filter(f => f !== selfRel && isText(f));
const docForbidden = [
  ['城市名「深圳」', /深圳/],
  ['旧体重 66.7', /66\.7/],
  ['旧体脂 19.5', /体脂 ?19\.5/],
  ['旧肌肉率 76.3', /76\.3/],
  ['旧基础代谢 1665', /1665/],
  ['旧年龄「29 岁」', /29 ?岁/],
  ['旧蛋白区间 107-147', /107-147/],
  ['旧蛋白区间 130-145', /130-145/],
  ['旧热量缺口 300-500', /300-500/],
  ['舌象基线日期 2026-09-25', /2026-09-25/],
  ['个人爱好「高尔夫」', /高尔夫/],
  ['真实 Git 用户名', /jlp111/],
  ['真实 QQ 邮箱', /1099758692|qq\.com/],
  ['本机绝对路径', /\/Users\/[a-zA-Z]/],
];
const docHits = [];
for (const f of scanFiles) {
  const c = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const [label, re] of docForbidden) if (re.test(c)) docHits.push(f + '：' + label);
}
ok('入库文本文件无硬编码个人数据（' + scanFiles.length + ' 文件 × ' + docForbidden.length + ' 模式）',
   docHits.length === 0, docHits.join('；').slice(0, 200));
const allText = scanFiles.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
ok('入库文本文件不含邮箱',
   !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(allText.replace(/example\.(com|org)/g, '')));
ok('入库文本文件不含疑似手机号', !/\b1[3-9]\d{9}\b/.test(allText));
ok('入库文本文件不含密钥类字段赋值',
   !/(api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}/i.test(allText));

console.log('\n' + '='.repeat(64));
console.log('脱敏回归结果：  PASS ' + pass + '   FAIL ' + fail);
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);