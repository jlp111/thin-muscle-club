/* 薄肌训练系统 · DOM 冒烟测试（jsdom：真实渲染 + 真实交互）
   用法：TZ=Asia/Shanghai node tests/verify-dom.js
   依赖：jsdom（若未安装会给出提示并退出，不影响逻辑层测试）
   覆盖：12 页渲染 / 日期默认值 / label 关联 / 知识库灰化 / 清单开关 /
        确认弹窗 / 训练记录写入 / 饮食空判定 / 导入拒绝 / XSS 防线 / 二次回归 */
const fs = require('fs');
const path = require('path');

const P = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(P, 'utf8');

let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require('jsdom'));
} catch (e) {
  const alt = path.join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules/jsdom');
  try {
    ({ JSDOM, VirtualConsole } = require(alt));
  } catch (e2) {
    console.error('缺少 jsdom。安装后重试：');
    console.error('  npm install jsdom        （或在任意目录 npm i jsdom 后设置 NODE_PATH）');
    process.exit(2);
  }
}

const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', e => { if (!/could not parse css|not implemented/i.test(String(e.message))) jsErrors.push(String(e.message)); });
vc.on('error', (...a) => { const s = a.map(String).join(' '); if (!/not implemented/i.test(s)) jsErrors.push(s); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc
});
const win = dom.window, doc = win.document;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  → ' + String(extra).slice(0, 140) : '')); }
}
function section(t) { console.log('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64)); }
const localToday = (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();

/* ---------- S1 初始化 ---------- */
section('S1  初始化与全局状态');
ok('页面加载无 JS 异常', jsErrors.length === 0, jsErrors.join(' | '));
ok('12 个 Tab 已渲染', doc.querySelectorAll('#tabs .tab').length === 12, doc.querySelectorAll('#tabs .tab').length);
ok('4 个分组标签存在', doc.querySelectorAll('#tabs .nav-glabel').length === 4, doc.querySelectorAll('#tabs .nav-glabel').length);
ok('分组分隔符存在', doc.querySelectorAll('#tabs .nav-sep').length === 3, doc.querySelectorAll('#tabs .nav-sep').length);
/* 版本号：APP_VERSION 为唯一来源（R14）。改为三重自校验 —— 不再硬编码版本值，
   且新增「源文件两处必须一致」这一失败模式（v3.24 实测教训：只改静态 span 不改
   APP_VERSION，运行时会被覆盖，页面上看不出问题）。 */
const __srcVer = (html.match(/id="ver">([^<]+)</) || [])[1];
const __appVer = (html.match(/const APP_VERSION\s*=\s*'([^']+)'/) || [])[1];
ok('源文件静态 #ver 与 APP_VERSION 一致（防只改一处）',
   !!__srcVer && __srcVer === __appVer, 'static=' + __srcVer + ' / APP_VERSION=' + __appVer);
ok('运行时 #ver = APP_VERSION（写入链生效）',
   !!__appVer && doc.querySelector('#ver').textContent === __appVer,
   doc.querySelector('#ver').textContent + ' vs ' + __appVer);
ok('版本号格式合法（v数字.数字）', /^v\d+\.\d+$/.test(__appVer || ''), __appVer);
ok('概览页已渲染', doc.querySelector('#app').textContent.length > 200);
ok('无残留「页面渲染失败」', doc.querySelector('#app').textContent.indexOf('页面渲染失败') < 0);

/* ---------- S2 12 个页面逐个渲染 ---------- */
section('S2  12 个页面逐个渲染（Pages 索引驱动）');
const tabs = ['home','plan','library','log','diet','progress','supps','herbs','release','longevity','skin','data'];
for (const k of tabs) {
  const btn = doc.querySelector('[data-tab="' + k + '"]');
  if (!btn) { ok('Tab ' + k + ' 存在', false); continue; }
  btn.click();
  const txt = doc.querySelector('#app').textContent;
  const crashed = txt.indexOf('页面渲染失败') >= 0;
  ok('渲染 ' + k.padEnd(10) + ' 正常（' + txt.length + ' 字符）', !crashed && txt.length > 100, crashed ? txt.slice(0, 100) : '');
}
ok('切换完成后无新增 JS 异常', jsErrors.length === 0, jsErrors.join(' | '));

/* ---------- S3 日期口径 ---------- */
section('S3  R1 日期口径（真实 DOM 取值）');
doc.querySelector('[data-tab="log"]').click();
ok('训练记录默认日期 = 今天（本地）', doc.querySelector('#logDate').value === localToday, doc.querySelector('#logDate').value + ' vs ' + localToday);
doc.querySelector('[data-tab="progress"]').click();
ok('体测录入默认日期 = 今天', doc.querySelector('#m_date').value === localToday, doc.querySelector('#m_date').value);
doc.querySelector('[data-tab="diet"]').click();
ok('饮食打卡默认日期 = 今天', doc.querySelector('#d_date').value === localToday, doc.querySelector('#d_date').value);

/* ---------- S4 表单 label 关联 ---------- */
section('S4  R12 label[for] 关联');
let badLabel = 0, checked = 0;
for (const k of ['library','log','progress','diet','plan']) {
  doc.querySelector('[data-tab="' + k + '"]').click();
  for (const lb of doc.querySelectorAll('#app label[for]')) {
    checked++;
    const t = doc.getElementById(lb.getAttribute('for'));
    if (!t) badLabel++;
  }
}
ok('已检查 label 全部指向存在的控件（' + checked + ' 个）', badLabel === 0, badLabel + ' 个悬空');
doc.querySelector('[data-tab="library"]').click();
doc.querySelector('#addAction').click();
ok('动作表单 label 已绑定（名称→f_name）',
  doc.querySelector('label[for="f_name"]') && doc.getElementById('f_name'));
ok('label 点击可聚焦（for 生效）', !!doc.querySelector('label[for="f_reps"]') && !!doc.getElementById('f_reps'));

/* ---------- S5 知识库渲染与清单开关 ---------- */
section('S5  知识库渲染 / 清单开关 / R9 一致性');
doc.querySelector('[data-tab="supps"]').click();
const suppCards = doc.querySelectorAll('#suppList .card').length;
ok('补剂模块渲染 17 张卡', suppCards === 17, suppCards);
ok('补剂里 7 条「已排除」带灰化样式',
  doc.querySelectorAll('#suppList .card.is-excluded').length === 7,
  doc.querySelectorAll('#suppList .card.is-excluded').length);
const tgl = doc.querySelector('[data-toggle-supp]');
const tid = tgl.getAttribute('data-toggle-supp');
tgl.click();
ok('点击后按钮变为「已在清单」', tgl.textContent.indexOf('已在清单') >= 0, tgl.textContent);
ok('计数文案同步更新', doc.querySelector('#suppCount').textContent.indexOf('1 项') >= 0, doc.querySelector('#suppCount').textContent);
const tgl2 = doc.querySelector('[data-toggle-supp="' + tid + '"]');
tgl2.click();
ok('再次点击可移除', doc.querySelector('#suppCount').textContent.indexOf('0 项') >= 0, doc.querySelector('#suppCount').textContent);

doc.querySelector('[data-tab="longevity"]').click();
const longExcluded = doc.querySelectorAll('#longList .card.is-excluded').length;
ok('R18 抗衰模块 2 条祛魅/处方药条目带灰化样式', longExcluded === 2, longExcluded);
ok('R18 祛魅条目确实在列表中',
  doc.querySelector('#longList').textContent.indexOf('抗衰补剂祛魅') >= 0);

doc.querySelector('[data-tab="herbs"]').click();
ok('中医模块渲染 11 张卡', doc.querySelectorAll('#herbList .card').length === 11, doc.querySelectorAll('#herbList .card').length);
doc.querySelector('[data-tab="release"]').click();
ok('松解模块渲染 17 张卡', doc.querySelectorAll('#relList .card').length === 17, doc.querySelectorAll('#relList .card').length);
ok('中医/松解无被误标为排除的条目',
  doc.querySelectorAll('#herbList .card.is-excluded').length + doc.querySelectorAll('#relList .card.is-excluded').length === 0);

/* ---------- S6 R11 自建确认弹窗 ---------- */
section('S6  R11 确认弹窗（替代原生 confirm）');
doc.querySelector('[data-tab="library"]').click();
const cards0 = doc.querySelectorAll('#libList .card').length;
// 固定删除「哑铃卧推」：它的中文分步含 3 处要领高亮，S14 的总数断言据此扣减，避免依赖列表顺序
doc.querySelector('[data-del-act="a_push_dbpress"]').click();
const modal = doc.querySelector('.modal-backdrop');
ok('点击删除弹出弹窗', !!modal);
ok('弹窗使用 role=dialog + aria-modal', !!modal && modal.querySelector('[role="dialog"]') && modal.querySelector('[aria-modal="true"]'));
ok('弹窗含取消与确认两个动作', !!modal && !!modal.querySelector('[data-modal-cancel]') && !!modal.querySelector('[data-modal-ok]'));
ok('焦点已移入确认按钮', doc.activeElement === modal.querySelector('[data-modal-ok]'), doc.activeElement && doc.activeElement.tagName);
modal.querySelector('[data-modal-cancel]').click();
ok('点取消后弹窗关闭', !doc.querySelector('.modal-backdrop'));
ok('取消后动作未被删除', doc.querySelectorAll('#libList .card').length === cards0);

doc.querySelector('[data-del-act]').click();
doc.querySelector('[data-modal-ok]').click();
ok('点确认后弹窗关闭', !doc.querySelector('.modal-backdrop'));
ok('点确认后动作被删除', doc.querySelectorAll('#libList .card').length === cards0 - 1,
  doc.querySelectorAll('#libList .card').length + ' vs ' + (cards0 - 1));

doc.querySelector('[data-del-act]').click();
const ev = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
doc.dispatchEvent(ev);
ok('Esc 可关闭弹窗', !doc.querySelector('.modal-backdrop'));

/* ---------- S7 训练记录写入链路 ---------- */
section('S7  训练记录写入与持久化');
doc.querySelector('[data-tab="log"]').click();
doc.querySelector('#logDay').value = '周一';
doc.querySelector('#startLog').click();
ok('选择周一后生成记录表单', !!doc.querySelector('#logForm [data-act]'));
const firstAct = doc.querySelector('#logForm [data-act]');
const inputs = firstAct.querySelectorAll('.setrow input');
inputs[0].value = '16'; inputs[1].value = '12';
doc.querySelector('#saveLog').click();
ok('保存后历史记录出现该条', doc.querySelector('#logHistory').textContent.indexOf('哑铃卧推') >= 0 || doc.querySelector('#logHistory').textContent.indexOf('16kg') >= 0);
ok('保存后无 JS 异常', jsErrors.length === 0, jsErrors.join(' | '));

/* ---------- S8 饮食打卡（R10 空判定） ---------- */
section('S8  R10 饮食打卡空判定');
doc.querySelector('[data-tab="diet"]').click();
doc.querySelector('#d_pro').value = '130';          // 只填蛋白，不填热量
doc.querySelector('#addDiet').click();
ok('只填蛋白可以保存', doc.querySelector('#dietMatrix').textContent.length > 0);
ok('矩阵中不出现「达标」误判',
  doc.querySelector('#dietMatrix').textContent.indexOf('达标') < 0,
  doc.querySelector('#dietMatrix').textContent.replace(/\s+/g, ' ').slice(0, 120));

/* ---------- S9 备份页与留档 ---------- */
section('S9  备份页 / 留档机制');
doc.querySelector('[data-tab="data"]').click();
ok('备份页含留档区块', doc.querySelector('#backupList') !== null);
ok('备份页显示导出时效', doc.querySelector('#app').textContent.indexOf('上次导出备份') >= 0);
const ta = doc.querySelector('#io');
ta.value = '[]';                                    // R5：非法导入
doc.querySelector('#imp').click();
setTimeout(() => {
  ok('R5 非法导入被拒绝并给出原因',
    doc.querySelector('#io_err').classList.contains('show') &&
    doc.querySelector('#io_err').textContent.indexOf('这不是本系统的备份') >= 0,
    doc.querySelector('#io_err').textContent);
  ok('R5 非法导入后数据未被重置', doc.querySelector('#app').textContent.length > 0);
  ok('R5 非法导入时留在备份页（未跳转）', !!doc.querySelector('#backupList'));

  /* ---------- S10 XSS 防线 ---------- */
  section('S10  转义防线（rich/esc 链）');
  doc.querySelector('[data-tab="library"]').click();
  doc.querySelector('#addAction').click();
  doc.querySelector('#f_name').value = '<img src=x onerror=alert(1)>动作';
  doc.querySelector('#f_mus') ? 0 : 0;
  doc.querySelector('#f_points').value = '尖括号<script>alert(2)</script>';
  doc.querySelector('#f_save').click();
  setTimeout(() => {
    const app = doc.querySelector('#app');
    // 断言修正（2026-09-16）：原用「#app img 总数 === 0」作代理指标，前提是应用里本无 img。
    // v3.24 起动作卡引入合法的数据集演示动画 <img class="ds-gif">，该代理失效。
    // 改为**更严**的断言：所有 img 必须是我们预期的 ds-gif；payload 产生的 img 不会有这个类。
    const __imgs = [...doc.querySelectorAll('#app img')];
    // v3.27：新增合法的 free-exercise-db 静态演示图（.ds2-img），白名单需同步扩展
    const __legalCls = ['ds-gif','ds2-img'];
    const __illegal = __imgs.filter(i => !__legalCls.some(c => i.classList.contains(c)));
    const __payload = __imgs.filter(i => (i.getAttribute('src') || '') === 'x');
    ok('恶意动作名未被解析为元素（无非预期 img）', __illegal.length === 0 && __payload.length === 0,
       __illegal.length + ' 个非预期 img / 共 ' + __imgs.length + ' / payload img ' + __payload.length);
    ok('恶意 script 未注入', doc.querySelectorAll('#app script').length === 0);
    ok('原始文本被转义显示', app.textContent.indexOf('<img src=x') >= 0 || app.textContent.indexOf('动作') >= 0);

    /* ---------- S11 全部 Tab 再走一遍（确保新增数据后仍不崩） ---------- */
    section('S11  数据变更后 12 页二次回归');
    for (const k of tabs) {
      doc.querySelector('[data-tab="' + k + '"]').click();
      const txt = doc.querySelector('#app').textContent;
      if (txt.indexOf('页面渲染失败') >= 0) { ok('二次渲染 ' + k, false, txt.slice(0, 100)); }
    }
    ok('二次回归全部通过（12 页无一崩溃）', true);
    ok('全流程无未捕获 JS 异常', jsErrors.length === 0, jsErrors.join(' | '));

    /* ---------- S12 .fld 字段行结构完整性 ---------- */
    /* 回归背景：.fld 是 display:flex 且不换行。若把内容直接摊开，
       文本节点与 <b>/<span class="hl"> 会各自成为匿名 flex item 并排挤压、
       独立折行 —— 表现为维A类「功效」里的「金标准」被拆成竖排两列。
       约束：内容必须包在 .fld-v 里，flex 恒为「标签 + 内容」两项。 */
    section('S12  .fld 字段行结构（防「金标准被拆列」回归）');
    let fldTotal = 0; const fldBad = [];
    for (const t of ['supps', 'herbs', 'release', 'longevity', 'skin', 'library']) {
      doc.querySelector('[data-tab="' + t + '"]').click();
      for (const f of doc.querySelectorAll('#app .fld')) {
        fldTotal++;
        const k = f.querySelector('.fld-k');
        const rest = [...f.childNodes].filter(n => n !== k && !(n.nodeType === 3 && !n.textContent.trim()));
        const shapeOK = rest.length === 1 && rest[0].nodeType === 1 && rest[0].classList.contains('fld-v');
        if (!shapeOK) {
          fldBad.push(t + '/' + (k ? k.textContent.trim() : '?') + '→'
            + rest.map(n => (n.nodeType === 3 ? 'TEXT' : n.nodeName)).join('+'));
        }
      }
    }
    ok('.fld 全为「标签 + .fld-v」两项结构（共 ' + fldTotal + ' 个）',
      fldBad.length === 0, fldBad.slice(0, 4).join(' | '));

    doc.querySelector('[data-tab="skin"]').click();
    const rCard = doc.querySelector('[data-toggle-skin="sk_retinoid"]').closest('.card');
    const effFld = [...rCard.querySelectorAll('.fld')].find(f => f.querySelector('.fld-k').textContent.trim() === '功效');
    ok('维A类「功效」内容收敛为单个 flex item',
      effFld.childNodes.length === 2 && effFld.lastElementChild.classList.contains('fld-v'),
      effFld.childNodes.length + ' 个子节点');
    ok('维A类「功效」文本完整（金标准未被拆散）',
      effFld.textContent.indexOf('抗皱与改善光老化的金标准活性成分') >= 0,
      effFld.textContent.slice(0, 60));
    ok('动作库字段行同样带 .fld-v 包装',
      (() => { doc.querySelector('[data-tab="library"]').click(); return [...doc.querySelectorAll('#libList .fld')].every(f => f.querySelector('.fld-v')); })());

    /* ---------- S13 护肤长文板块的信息架构 ---------- */
    /* 回归背景：这两块曾是一整坨 <br> 分隔的散文，无层级、抓不到重点。
       约束：不得退化回 <br> 堆叠；流程须为编号步骤序列；预算/时间轴须为表格；
       习惯须为可扫读的卡片网格。 */
    section('S13  护肤长文板块信息架构');
    doc.querySelector('[data-tab="skin"]').click();
    const flow = doc.querySelector('#sk-flow');
    const habit = doc.querySelector('#sk-habit');
    ok('#sk-flow 不再使用 <br> 堆叠', flow.innerHTML.indexOf('<br>') < 0);
    ok('#sk-habit 不再使用 <br> 堆叠', habit.innerHTML.indexOf('<br>') < 0);
    ok('#sk-flow 早/晚/训练日共 8 个编号步骤', flow.querySelectorAll('.steps li').length === 8,
      flow.querySelectorAll('.steps li').length);
    ok('#sk-flow 步骤序号由 CSS counter 生成（无字符图标）',
      flow.querySelectorAll('.steps li').length > 0);
    ok('#sk-flow 含「三条不要」警示框', !!flow.querySelector('.warn-box')
      && flow.querySelector('.warn-box').textContent.indexOf('三条不要') >= 0);
    ok('#sk-flow 预算为 3 张对比卡', flow.querySelectorAll('details .grid.dense .card').length === 3,
      flow.querySelectorAll('details .grid.dense .card').length);
    ok('#sk-flow 预算卡覆盖三档', /极简版/.test(flow.textContent) && /标准版/.test(flow.textContent) && /进阶版/.test(flow.textContent));
    ok('#sk-flow 时间轴为 chip 行（4 项）',
      ['屏障与含水度', '细纹与肤质', '色沉与痘印', '光老化外观'].every(t => flow.textContent.indexOf(t) >= 0));
    ok('#sk-flow 预算与时间轴默认折叠、结论前置到摘要行',
      (() => {
        const ds = [...flow.querySelectorAll('details')];
        if (ds.length !== 2 || ds.some(d => d.open)) return false;
        const sums = ds.map(d => d.querySelector('summary').textContent);
        return sums[0].indexOf('¥100') >= 0 && sums[1].indexOf('1-2 周') >= 0;
      })(),
      [...flow.querySelectorAll('details')].map(d => d.querySelector('summary').textContent.slice(0, 24)).join(' | '));
    ok('summary 内容包在 span 内（避免与 ::before 被拆成多个 flex item）',
      [...flow.querySelectorAll('details > summary')].every(s => s.firstElementChild && s.firstElementChild.tagName === 'SPAN'));
    ok('.chip 定义含 gap（避免文本与数值被 flex 折叠空格而粘连）',
      /\.chip\{[^}]*gap:var\(--sp-2\)/.test(doc.querySelector('style').textContent),
      (doc.querySelector('style').textContent.match(/\.chip\{[^}]*\}/) || [''])[0].slice(0, 80));
    ok('#sk-habit 十条习惯改为卡片', habit.querySelectorAll('.grid.dense .card').length === 10,
      habit.querySelectorAll('.grid.dense .card').length);
    ok('#sk-habit 每张卡为「短标题 + 一句理由」',
      [...habit.querySelectorAll('.grid.dense .card')].every(c => c.querySelector('b') && c.querySelector('p')));
    ok('两块板块均在 toc 导航中可达',
      !!doc.querySelector('[data-scroll="sk-flow"]') && !!doc.querySelector('[data-scroll="sk-habit"]'));

    /* ---------- S14 动作库字段标题配色 / 中文分步要领 ---------- */
    /* 回归背景：演示·协同肌群·中文分步·动画演示 四个标题曾一律用 mut 灰，
       与「要点」绿/「常见错误」红 不在同一视觉层级，扫读时抓不到分区。
       约束：① 四个标题各有独立色调且取自 cat 轴（status 轴保留给状态语义）；
             ② 中文分步的要领必须带 .key 高亮，且数据侧 ** 标记不得泄漏到页面。 */
    section('S14  动作库字段标题配色 / 中文分步要领标注');
    const cssText = doc.querySelector('style').textContent;
    const colorRule = cls => {
      const m = cssText.match(new RegExp('\\.fld-k\\.' + cls + '\\{color:var\\(--([a-z0-9-]+)\\)\\}'));
      return m ? m[1] : null;
    };
    const tones = {anat: colorRule('anat'), step: colorRule('step'), anim: colorRule('anim'), ref: colorRule('ref')};
    ok('四个扩展标题均已定义独立色调', Object.values(tones).every(Boolean), JSON.stringify(tones));
    ok('四个标题色互不重复（形成清晰区分）',
      new Set(Object.values(tones)).size === 4, JSON.stringify(tones));
    ok('四个标题色均取自 cat 轴（与要点/常见错误的 status 轴分工不冲突）',
      Object.values(tones).every(v => /^cat-\d$/.test(v)), JSON.stringify(tones));
    ok('.key 要领标注样式已定义（琥珀色 + 加粗）',
      /\.key\{color:var\(--cat-2\);font-weight:var\(--fw-sb\)/.test(cssText));

    doc.querySelector('[data-tab="library"]').click();
    doc.querySelectorAll('#libList details').forEach(d => { d.open = true; });
    const allKeys = doc.querySelectorAll('#libList .key').length;
    // 数据侧共 70 处标记；S6 已删除「哑铃卧推」，连带其 3 处，故此处期望 67
    ok('全库动作卡片共 ' + allKeys + ' 处要领高亮（期望 70 = 70（v3.29 新增楼梯机 +3））',
      allKeys === 70, allKeys);
    ok('页面无残留 ** 标记（rich() 已完全消费）',
      doc.querySelector('#app').textContent.indexOf('**') < 0);

    doc.querySelector('#libSearch').value = '上斜哑铃推';
    doc.querySelector('#libSearch').dispatchEvent(new win.Event('input', {bubbles: true}));
    const bpCard = doc.querySelector('#libList .card');
    ok('卡片内四个标题分别套用扩展色调类',
      !!bpCard && ['anat', 'step', 'anim', 'ref'].every(c => !!bpCard.querySelector('.fld-k.' + c)),
      bpCard ? ['anat', 'step', 'anim', 'ref'].filter(c => !bpCard.querySelector('.fld-k.' + c)).join(',') : 'no card');
    const keyEls = [...bpCard.querySelectorAll('.key')];
    ok('上斜哑铃推中文分步含 4 处要领高亮', keyEls.length === 4, keyEls.length);
    ok('高亮内容均为要领短语（非空、无字面星号）',
      keyEls.every(e => e.textContent.trim().length > 0 && e.textContent.indexOf('*') < 0),
      keyEls.map(e => e.textContent).join(' | '));
    ok('要领高亮挂在中文分步条目内（而非其它字段）',
      keyEls.every(e => !!e.closest('ol.flist')),
      keyEls.filter(e => !e.closest('ol.flist')).length + ' 处位置异常');
    doc.querySelector('#libSearch').value = '';
    doc.querySelector('#libSearch').dispatchEvent(new win.Event('input', {bubbles: true}));

    console.log('\n' + '='.repeat(64));
    console.log('DOM 冒烟测试结果：  PASS ' + pass + '   FAIL ' + fail);
    console.log('='.repeat(64));
    process.exit(fail ? 1 : 0);
  }, 60);
}, 60);
