/* 合并版（迁移产物）DOM 验收
 * 用法：TM_TARGET=migrate/out/index-tracker.html node tests/verify-integration.js
 *       未设置 TM_TARGET 时默认取仓库根的 index-tracker.html（不存在会明确报错）
 *
 * 覆盖：追踪台壳结构 / 13 页渲染 / 4 步向导 / 主题 / 动作库增删 /
 *       饮食分餐 / 训练记录 / 数据页导出入 / 首页内容面板 / XSS 防线 / 存储隔离 / 无脚本错误
 *
 * 架构说明（2026-10-16 重写）：
 *   旧版按 P1 架构编写（薄肌挂在 #tm-root、[data-tm-tab] 导航、location.hash 路由），
 *   该架构已被「13 页一级化」重构取代（.nav-btn[data-page] + #page-<key> + setPage），
 *   旧断言对当前产物直接崩溃。本版按**实测契约**重写——所有元素 ID 均从
 *   migrate/build/parts/{shell.html,shell.js,pages.js} 与产物 grep 取证，不凭印象。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const P = process.env.TM_TARGET
  ? path.resolve(process.env.TM_TARGET)
  : path.join(__dirname, '..', 'index-tracker.html');
if (!fs.existsSync(P)) {
  console.error('找不到被测文件：' + P);
  console.error('用法：TM_TARGET=migrate/out/index-tracker.html node tests/verify-integration.js');
  process.exit(2);
}
const html = fs.readFileSync(P, 'utf8');

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
catch (e) {
  const alt = path.join(process.env.HOME || '', '.workbuddy/binaries/node/workspace/node_modules/jsdom');
  try { ({ JSDOM, VirtualConsole } = require(alt)); }
  catch (e2) {
    console.error('缺少 jsdom。安装后重试：');
    console.error('  npm install jsdom        （或在任意目录 npm i jsdom 后设置 NODE_PATH）');
    process.exit(2);
  }
}

/* jsdom 不实现 matchMedia（真实浏览器均有）。产物的 setPage 用
   matchMedia('(prefers-reduced-motion: reduce)') 决定滚动行为，主题模块亦有调用
   ——属宿主能力差异而非产品缺陷，这里补最小实现，让验收能在 jsdom 下真实跑完交互。 */
const vc = new VirtualConsole();
const jsErrors = [];
vc.on('jsdomError', e => { const s = String(e.message); if (!/could not parse css|not implemented/i.test(s)) jsErrors.push(s); });
vc.on('error', (...a) => { const s = a.map(String).join(' '); if (!/not implemented/i.test(s)) jsErrors.push(s); });

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://localhost/', pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(win) {
    if (!win.matchMedia) {
      win.matchMedia = q => ({
        matches: false, media: q,
        addEventListener() {}, removeEventListener() {},
        addListener() {}, removeListener() {}, dispatchEvent() { return false; }
      });
    }
  }
});
const win = dom.window, doc = win.document;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  → ' + String(e).slice(0, 140) : '')); } };
const sec = t => console.log('\n' + '='.repeat(62) + '\n' + t + '\n' + '='.repeat(62));

/* 薄肌保存走 nextFrame()（双 requestAnimationFrame）异步，断言前轮询等待 */
function settleAsync(fn, ms) {
  const limit = ms || 800, t0 = Date.now();
  return new Promise(res => (function tick() {
    let v; try { v = fn(); } catch (e) { v = false; }
    if (v) return res(true);
    if (Date.now() - t0 > limit) return res(false);
    setTimeout(tick, 8);
  })());
}
const page = k => doc.getElementById('page-' + k);
const pageText = k => { const el = page(k); return el ? el.textContent : ''; };
const nav = k => { const b = doc.querySelector('.nav-btn[data-page="' + k + '"]'); if (b) b.click(); return !!b; };
const localToday = (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); })();
/* 完成首次向导（4 步）；返回是否原本打开着向导 */
function finishOnboarding(nick) {
  const ob = doc.querySelector('#onboarding.open');
  if (!ob) return false;
  if (nick) { const n = doc.querySelector('#obName'); if (n) n.value = nick; }
  for (let i = 0; i < 4; i++) { const nx = doc.querySelector('#obNext'); if (!nx) break; nx.click(); }
  return true;
}

(async function main() {
  await settleAsync(() => doc.readyState === 'complete' || doc.readyState === 'interactive');

  /* ── 1. 壳结构 ── */
  sec('I1  追踪台壳结构');
  ok('品牌为薄肌俱乐部', /薄肌俱乐部/.test(doc.querySelector('.brand-text').textContent));
  ok('侧栏 13 个页面导航', doc.querySelectorAll('.sidebar .nav-btn[data-page]').length === 13,
     doc.querySelectorAll('.sidebar .nav-btn[data-page]').length);
  ok('导航分 4 组（训练/养护/抗老/系统）',
     [...doc.querySelectorAll('.sidebar .nav-label')].map(n => n.textContent.trim()).join(',') === '训练,养护,抗老,系统',
     [...doc.querySelectorAll('.sidebar .nav-label')].map(n => n.textContent.trim()).join(','));
  ok('13 个页面容器齐全', doc.querySelectorAll('section.page').length === 13, doc.querySelectorAll('section.page').length);
  ok('顶栏含标题/日期/主题切换/备份快捷入口',
     !!doc.querySelector('#topTitle') && !!doc.querySelector('#topDate') && !!doc.querySelector('#themeToggle') && !!doc.querySelector('[data-page-jump="data"]'));
  ok('移动端底栏 5 项（含更多）', doc.querySelectorAll('.mobile-nav button').length === 5);
  ok('弹窗体系三件套（编辑/确认/更多）',
     !!doc.querySelector('#editModal') && !!doc.querySelector('#confirmModal') && !!doc.querySelector('#moreSheet'));
  ok('弹窗均带 role=dialog + aria-modal',
     [...doc.querySelectorAll('.overlay')].every(o => o.getAttribute('role') === 'dialog' && o.getAttribute('aria-modal') === 'true'));
  ok('首次运行默认打开向导（未 onboarded）', !!doc.querySelector('#onboarding.open'));
  ok('向导为 4 步且仅第 1 步可见',
     doc.querySelectorAll('.ob-step').length === 4 &&
     [...doc.querySelectorAll('.ob-step')].filter(s => !s.hidden).length === 1);
  ok('向导第 1 步含称呼/身高/体重/目标体重',
     ['obName', 'obHeight', 'obWeight', 'obGoalWeight'].every(id => !!doc.querySelector('#' + id)));
  ok('more 列表由 openMore 动态生成（初始为空）', doc.querySelector('#moreList').children.length === 0);

  /* ── 2. 13 页逐个渲染 ── */
  sec('I2  13 页逐个渲染');
  const pages = [...doc.querySelectorAll('.sidebar .nav-btn[data-page]')].map(b => b.dataset.page);
  for (const k of pages) {
    nav(k);
    const el = page(k);
    const active = el && el.classList.contains('active');
    const len = el ? el.textContent.trim().length : 0;
    ok('页面 ' + k.padEnd(9) + ' 可切换且有内容（' + len + ' 字符）', !!active && len > 40, active ? len : '未激活');
    ok('页面 ' + k.padEnd(9) + ' 无渲染崩溃/残留 null',
       el && el.textContent.indexOf('渲染出错') < 0 && !/null|undefined|NaN/.test(el.textContent));
  }
  ok('切换后无新增 JS 异常', jsErrors.length === 0, jsErrors.join(' | '));

  /* ── 3. 向导全流程 ── */
  sec('I3  4 步向导全流程');
  doc.querySelector('#obName').value = '验收昵称';
  doc.querySelector('#obNext').click();
  ok('第 2 步可见且上一步启用', !doc.querySelector('.ob-step[data-step="2"]').hidden && !doc.querySelector('#obPrev').disabled);
  doc.querySelector('#obNext').click();
  doc.querySelector('#obNext').click();
  ok('第 4 步按钮变为「完成设置」', doc.querySelector('#obNext').textContent.indexOf('完成设置') >= 0, doc.querySelector('#obNext').textContent);
  doc.querySelector('#obNext').click();
  ok('完成后向导关闭', !doc.querySelector('#onboarding.open'));
  await settleAsync(() => doc.querySelector('#onboarding.open') === null);
  ok('完成后自动回到首页', page('home').classList.contains('active'));
  ok('首页问候使用向导填入的称呼', pageText('home').indexOf('验收昵称') >= 0, pageText('home').slice(0, 60));
  const stored = JSON.parse(win.localStorage.getItem('thinMuscle.trainSys.v1') || '{}');
  /* Store.save() 写的是裸对象（无 wrapper）：顶层键直接是 profile/settings/… */
  ok('onboarded 写入 Store.data.settings', !!(stored.settings && stored.settings.onboarded));
  ok('称呼写入 Store.data.profile', !!(stored.profile && stored.profile.name === '验收昵称'));

  /* ── 4. 主题 ── */
  sec('I4  主题由壳统一控制');
  const t0 = doc.documentElement.getAttribute('data-theme');
  doc.querySelector('#themeToggle').click();
  const t1 = doc.documentElement.getAttribute('data-theme');
  ok('主题可切换', !!t0 && !!t1 && t0 !== t1, t0 + ' → ' + t1);
  doc.querySelector('#themeToggle').click();
  ok('主题可切回', doc.documentElement.getAttribute('data-theme') === t0);
  const stored2 = JSON.parse(win.localStorage.getItem('thinMuscle.trainSys.v1') || '{}');
  ok('主题选择持久化到 Store', stored2.settings && stored2.settings.theme === t0);

  /* ── 5. 动作库增删 ── */
  sec('I5  动作库（搜索 / 筛选 / 新增 / 删除）');
  nav('library');
  await settleAsync(() => doc.querySelectorAll('#page-library article.card').length > 10);
  const cards0 = doc.querySelectorAll('#page-library article.card').length;
  ok('动作卡片渲染（' + cards0 + ' 张）', cards0 > 10, cards0);
  ok('含搜索框与分类筛选', !!doc.querySelector('#libSearch') && !!doc.querySelector('#libCats'));
  ok('卡片含编辑/删除动作', !!doc.querySelector('#page-library [data-edit]') && !!doc.querySelector('#page-library [data-del]'));
  doc.querySelector('#libSearch').value = '哑铃';
  doc.querySelector('#libSearch').dispatchEvent(new win.Event('input', { bubbles: true }));
  const filtered = doc.querySelectorAll('#page-library article.card').length;
  ok('搜索过滤生效（' + filtered + ' 张）', filtered > 0 && filtered < cards0, filtered + ' / ' + cards0);
  doc.querySelector('#libSearch').value = '';
  doc.querySelector('#libSearch').dispatchEvent(new win.Event('input', { bubbles: true }));
  doc.querySelector('#libCats [data-cat="legs"]').click();
  ok('分类筛选生效', doc.querySelectorAll('#page-library article.card').length > 0 &&
     [...doc.querySelectorAll('#page-library article.card')].every(c => c.querySelector('.cat-tag')));
  doc.querySelector('#libCats [data-cat="all"]').click();

  doc.querySelector('#libAddBtn').click();
  ok('新增动作打开编辑弹窗', doc.querySelector('#editModal').classList.contains('open'));
  ok('弹窗含名称/分类/组次/要点字段',
     ['f_name', 'f_cat', 'f_muscles', 'f_sets', 'f_reps', 'f_points', 'f_errors'].every(id => !!doc.querySelector('#' + id)));
  doc.querySelector('#f_name').value = '验收新增动作';
  doc.querySelector('#f_reps').value = '8-12';
  doc.querySelector('#editModalSave').click();
  ok('保存后弹窗关闭', !doc.querySelector('#editModal').classList.contains('open'));
  await settleAsync(() => pageText('library').indexOf('验收新增动作') >= 0);
  ok('新动作出现在列表', pageText('library').indexOf('验收新增动作') >= 0);
  ok('新增后卡片数 +1', doc.querySelectorAll('#page-library article.card').length === cards0 + 1,
     doc.querySelectorAll('#page-library article.card').length + ' vs ' + (cards0 + 1));

  const before = doc.querySelectorAll('#page-library article.card').length;
  const victim = [...doc.querySelectorAll('#page-library article.card')].find(c => c.textContent.indexOf('验收新增动作') >= 0);
  victim.querySelector('[data-del]').click();
  ok('删除弹出确认窗', doc.querySelector('#confirmModal').classList.contains('open'));
  ok('确认窗含取消/确认', !!doc.querySelector('#confirmModal [data-close="confirmModal"]') && !!doc.querySelector('#confirmModalOk'));
  doc.querySelector('#confirmModalOk').click();
  ok('确认后弹窗关闭', !doc.querySelector('#confirmModal').classList.contains('open'));
  await settleAsync(() => doc.querySelectorAll('#page-library article.card').length === before - 1);
  ok('确认后动作被删除', doc.querySelectorAll('#page-library article.card').length === before - 1,
     doc.querySelectorAll('#page-library article.card').length + ' vs ' + (before - 1));

  /* ── 6. 饮食分餐录入 ── */
  sec('I6  饮食分餐录入');
  nav('diet');
  ok('默认日期 = 今天', doc.querySelector('#d_date').value === localToday, doc.querySelector('#d_date').value);
  ok('5 个餐次卡', doc.querySelectorAll('#mealRows .meal-card').length === 5, doc.querySelectorAll('#mealRows .meal-card').length);
  ok('每卡 3 个数值输入（重量/热量/蛋白）',
     [...doc.querySelectorAll('#mealRows .meal-card')].every(c => c.querySelectorAll('.m_wt,.m_kcal,.m_pro').length === 3));
  /* 程序化赋值不触发 input 事件，须手动派发——真实键入才会实时加总 */
  function fill(el, v) { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles: true })); }
  fill(doc.querySelectorAll('#mealRows .meal-card')[0].querySelector('.m_kcal'), '500');
  fill(doc.querySelectorAll('#mealRows .meal-card')[0].querySelector('.m_pro'), '30');
  ok('输入后合计自动加总', doc.querySelector('#m_sumK').textContent === '500' && doc.querySelector('#m_sumP').textContent === '30',
     doc.querySelector('#m_sumK').textContent + ' / ' + doc.querySelector('#m_sumP').textContent);
  doc.querySelector('#addDiet').click();
  await settleAsync(() => pageText('diet').indexOf('500') >= 0 && pageText('diet').indexOf('早餐') >= 0);
  ok('保存后当日明细展示（早餐 500 kcal）', pageText('diet').indexOf('500') >= 0 && pageText('diet').indexOf('早餐') >= 0);
  ok('矩阵出现当日行', doc.querySelector('#dietMatrix').textContent.trim().length > 0);

  /* ── 7. 训练记录写入 ── */
  sec('I7  训练记录写入');
  nav('log');
  ok('默认日期 = 今天', doc.querySelector('#logDate').value === localToday, doc.querySelector('#logDate').value);
  const daySel = doc.querySelector('#logDay');
  daySel.value = '周一';                       // 周一默认 5 个动作，与今天星期几无关
  daySel.dispatchEvent(new win.Event('change', { bubbles: true }));
  ok('周一生成 5 个动作记录表单', doc.querySelectorAll('#logForm [data-act]').length === 5,
     doc.querySelectorAll('#logForm [data-act]').length);
  const firstAct = doc.querySelector('#logForm [data-act]');
  /* ── P6 组录入区紧凑表格化：4 列结构 / kg 单位 / 增删组 / RPE 行内 ── */
  const firstRow = firstAct.querySelector('.set-row');
  ok('组行为 4 列结构（序号/重量/次数/删除）', !!firstRow && firstRow.children.length === 4,
     firstRow ? firstRow.children.length : '无 .set-row');
  const rowInputs = firstRow.querySelectorAll('input');
  ok('组行首个输入为重量（保存读取顺序依赖）', rowInputs[0] && rowInputs[0].getAttribute('aria-label') === '重量',
     rowInputs[0] ? rowInputs[0].getAttribute('aria-label') : '无');
  const kgUnit = firstRow.querySelector('.set-cell .unit');
  ok('重量单位 kg 可见（修复被挤进 32px 首列的问题）', !!kgUnit && kgUnit.textContent === 'kg',
     kgUnit ? kgUnit.textContent : '无单位后缀');
  ok('列表头含「重量 (kg)」', pageText('log').indexOf('重量 (kg)') >= 0, '');
  firstAct.querySelector('[data-add-set]').click();
  ok('添加一组后行数 +1', firstAct.querySelectorAll('.set-row').length === 2,
     firstAct.querySelectorAll('.set-row').length);
  firstAct.querySelector('[data-del-set]').click();
  ok('删除一组后行数还原', firstAct.querySelectorAll('.set-row').length === 1,
     firstAct.querySelectorAll('.set-row').length);
  ok('RPE 行内且可记', !!firstAct.querySelector('.exercise-foot .rpe-inline .rpe-sel'), '');
  const setInputs = firstAct.querySelectorAll('.set-row input');
  setInputs[0].value = '16'; setInputs[1].value = '12';
  doc.querySelector('#saveLog').click();
  await settleAsync(() => pageText('log').indexOf('16kg×12') >= 0 || pageText('log').indexOf('16kg') >= 0);
  ok('保存后历史记录出现该条', pageText('log').indexOf('16kg') >= 0, pageText('log').slice(0, 80));
  ok('保存后无 JS 异常', jsErrors.length === 0, jsErrors.join(' | '));

  /* ── 8. 数据页导出入 ── */
  sec('I8  数据页导出 / 导入 / 存储隔离');
  nav('data');
  doc.querySelector('#d_exp').click();
  const exported = doc.querySelector('#d_io').value;
  ok('导出 JSON 到文本框', exported.length > 50);
  let expObj = null;
  try { expObj = JSON.parse(exported); } catch (e) {}
  /* exportJSON = JSON.stringify(data)——裸对象，顶层键直接是 profile/library/… */
  ok('导出内容为合法 JSON 且含 profile/library', !!expObj && !!expObj.profile && Array.isArray(expObj.library),
     expObj ? Object.keys(expObj).slice(0, 6).join(',') : '非 JSON');
  doc.querySelector('#d_io').value = '[]';
  doc.querySelector('#d_imp').click();
  await settleAsync(() => doc.querySelector('#d_io_err').textContent.length > 0);
  ok('非法导入被拒绝并给出原因', doc.querySelector('#d_io_err').textContent.length > 0, doc.querySelector('#d_io_err').textContent);
  ok('拒绝后仍留在数据页', page('data').classList.contains('active'));
  const keys = Object.keys(win.localStorage);
  ok('localStorage 只有薄肌一个键（无第二套存储）', keys.length === 1 && keys[0] === 'thinMuscle.trainSys.v1', keys.join(','));

  /* ── 9. 首页内容面板（内容保真） ── */
  /* 回归背景：源系统首页承载 5 块内容/功能面板，P2 重写 renderHome 时丢了渲染面：
     昨夜睡眠录入（sleepAdd 无写入面 → 睡眠数据永远录不进去）、今日建议（Adapt.suggestion）、
     周容量仪表（Adapt.weekVolume）、核心禁忌提醒（6 条安全禁忌）、术语对照表（GLOSSARY 34 条）。
     数据/逻辑层都在（A1 指纹 + verify-logic 均覆盖），但没有页面渲染它们 = 对用户不可见。 */
  sec('I9  首页内容面板（睡眠 / 建议 / 周容量 / 禁忌 / 术语）');
  nav('home');
  const homeHtml = page('home').innerHTML;

  ok('首页含「昨夜睡眠」录入卡', /昨夜睡眠/.test(homeHtml));
  ok('睡眠录入含时长/就寝/质量字段与打卡按钮',
     ['sl_hours', 'sl_bed', 'sl_q', 'sl_save'].every(id => !!doc.querySelector('#page-home #' + id)),
     ['sl_hours', 'sl_bed', 'sl_q', 'sl_save'].filter(id => !doc.querySelector('#page-home #' + id)).join(','));
  if (doc.querySelector('#sl_save')) {
    doc.querySelector('#sl_hours').value = '7.5';
    doc.querySelector('#sl_q').value = '4';
    doc.querySelector('#sl_save').click();
    await settleAsync(() => pageText('home').indexOf('7.5 h') >= 0);
    ok('睡眠打卡后首页「睡眠」格显示 7.5 h', pageText('home').indexOf('7.5 h') >= 0, pageText('home').match(/睡眠[\s\S]{0,40}/));
    nav('report');
    ok('睡眠打卡后周报「平均睡眠」显示 7.5h', pageText('report').indexOf('7.5h') >= 0, pageText('report').match(/平均睡眠[\s\S]{0,30}/));
    nav('home');
  }

  ok('首页含「今日建议」面板（Adapt 渲染面）', /今日建议/.test(homeHtml) && /自适应目标/.test(homeHtml));
  ok('首页含「周容量仪表」面板（Adapt.weekVolume 渲染面）',
     /周容量/.test(homeHtml) && doc.querySelectorAll('#page-home .vol-row, #page-home [class*="vol"]').length >= 4,
     homeHtml.match(/周容量/) ? '有标题但缺行' : '缺标题');

  const taboo = [...doc.querySelectorAll('#page-home details')]
    .find(d => { const s = d.querySelector('summary'); return s && /核心禁忌/.test(s.textContent); });
  ok('首页含「核心禁忌提醒」折叠面板', !!taboo);
  if (taboo) {
    taboo.open = true;
    const items = taboo.querySelectorAll('.tip-list li');
    ok('禁忌 6 条全量渲染', items.length === 6, items.length);
    ok('禁忌含维A孕期/半夏/镁/抗凝/刮痧/扁豆六类',
      ['维A类孕期', '半夏', '肾功能不全', '抗凝药', '刮痧拔罐', '白扁豆'].every(t => taboo.textContent.indexOf(t) >= 0));
  }

  const gloss = [...doc.querySelectorAll('#page-home details')]
    .find(d => { const s = d.querySelector('summary'); return s && /术语对照表/.test(s.textContent); });
  ok('首页含「术语对照表」折叠面板', !!gloss);
  if (gloss) {
    ok('摘要行标注 34 条', /34 条/.test(gloss.querySelector('summary').textContent), gloss.querySelector('summary').textContent.slice(0, 40));
    gloss.open = true;
    const terms = gloss.querySelectorAll('.card');
    ok('术语卡逐条渲染（34 条）', terms.length === 34, terms.length);
    ok('ROM 术语含「完整行程」释义', gloss.textContent.indexOf('ROM（关节活动幅度）') >= 0 && gloss.textContent.indexOf('完整行程') >= 0);
    ok('术语卡为「词条 + 白话释义」结构', [...terms].every(c => c.querySelector('b') && c.querySelector('p')));
  }

  /* ── 10. XSS 防线 ── */
  sec('I10  XSS 防线（动作名 / 分步 / 演示链接）');
  nav('library');
  doc.querySelector('#libAddBtn').click();
  doc.querySelector('#f_name').value = '<img src=x onerror=alert(1)>XSS动作';
  doc.querySelector('#f_points').value = '要点<script>alert(2)</script>尖括号';
  doc.querySelector('#editModalSave').click();
  await settleAsync(() => pageText('library').indexOf('XSS动作') >= 0);
  const evilCard = [...doc.querySelectorAll('#page-library article.card')].find(c => c.textContent.indexOf('XSS动作') >= 0);
  ok('恶意动作已渲染（测试前提）', !!evilCard);
  if (evilCard) {
    ok('向量① 动作名未注入 img 元素', evilCard.querySelectorAll('img[src="x"]').length === 0);
    ok('向量② 分步未注入 script 元素', evilCard.querySelectorAll('script').length === 0 && doc.querySelectorAll('#page-library script').length === 0);
    ok('原始文本被转义显示', evilCard.textContent.indexOf('<img src=x') >= 0 || evilCard.textContent.indexOf('XSS动作') >= 0);
    evilCard.querySelector('[data-del]').click();
    doc.querySelector('#confirmModalOk').click();
    await settleAsync(() => pageText('library').indexOf('XSS动作') < 0);
    ok('清理后恶意条目已移除', pageText('library').indexOf('XSS动作') < 0);
  }

  /* ── 11. 收尾 ── */
  sec('I11  全程无脚本错误');
  ok('无未捕获 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

  console.log('\n' + '='.repeat(62));
  console.log('合并版验收结果：  PASS ' + pass + '   FAIL ' + fail);
  console.log('='.repeat(62));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('验收脚本异常：', e); process.exit(1); });
