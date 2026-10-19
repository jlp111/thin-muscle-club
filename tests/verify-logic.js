/* 薄肌训练系统 · 逻辑层回归测试（纯 Node，零依赖）
   用法：TZ=Asia/Shanghai node tests/verify-logic.js
   覆盖：Util 日期口径 / Schema.normalize / 版本迁移 / 导入校验 / 删除黑名单 /
        体测趋势 / 饮食空判定 / 持久化失败可见化 / 存储损坏抢救 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

/* 被测文件可由 TM_TARGET 指定：默认 index.html，合并版传 index-tracker.html */
const P = process.env.TM_TARGET
  ? path.resolve(process.env.TM_TARGET)
  : path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(P, 'utf8');

/* 定位「主脚本」而非「第一个 script」：v3.32 起 <head> 内新增了防闪烁内联脚本，
   用 indexOf('<script>') 会从那支小脚本内部开始切片、跨越 </script><body> 与主脚本标签，
   导致 vm 报 `Unexpected token '<'`。
   注意：断言逻辑未改动，只修正提取锚点。

   合并版 index-tracker.html 里，这段标记会出现两次：
     ① 页面正文（#tm-root 内）里的一段说明性注释
     ② 薄肌主脚本里真正的模块分隔注释
   因此不能取第一次出现，必须取「位于某个 <script>…</script> 内部」的那一次。
   原版 index.html 只有一次，天然满足该条件，两种文件都能正确定位。 */
const UI_MARK_STR = '/* ----------------------- 模块: UI (路由/渲染) ----------------------- */';
/* 逻辑层定位（架构无关）：迁移产物会废弃薄肌 UI 模块，届时 UI 标记注释不复存在。
   因此右边界按优先级回落：UI 标记 → `const UI =` 声明 → 脚本块尾。
   旧结构（index.html）走第一条，行为与改动前完全一致；新结构走后两条。
   注意：断言逻辑未改动，只修正提取锚点。 */
function locateLogic(text, kbIdx) {
  const ps = text.lastIndexOf('<script', kbIdx);
  const s0 = text.indexOf('>', ps) + 1;
  let end = locateUiMark(text);
  if (end < 0) {
    end = text.indexOf('const UI = (function(){', kbIdx);
    if (end < 0) end = text.indexOf('</script>', s0);
  }
  return { s0, end };
}
function locateUiMark(text) {
  let from = 0, at;
  while ((at = text.indexOf(UI_MARK_STR, from)) !== -1) {
    /* 该标记是否落在某个脚本块内部？ */
    const ps = text.lastIndexOf('<script', at);
    if (ps !== -1) {
      const pe = text.indexOf('>', ps) + 1;
      const cl = text.indexOf('</script>', pe);
      if (pe < at && cl > at) return at;
    }
    from = at + UI_MARK_STR.length;
  }
  return -1;
}
/* 逻辑层切片：起点取「包含 KbData 的那个 <script> 块」的体起点（Util 定义在其前，必须一并纳入）；
   终点由 locateLogic 按优先级回落决定。
   这样既兼容原版 index.html（终点 = UI 标记注释），
   也兼容迁移产物（UI 模块已废弃、无标记 → 终点 = `const UI =` 或脚本尾）。 */
const KB_ANCHOR = 'const KbData = (function(){';
const kbIdx = src.indexOf(KB_ANCHOR);
if (kbIdx < 0) throw new Error('未找到逻辑层锚点 const KbData');
const { s0, end } = locateLogic(src, kbIdx);
if (s0 <= 0 || end <= s0) throw new Error('逻辑层切片范围非法: s0=' + s0 + ' end=' + end);
const code = src.slice(s0, end);

function makeLS() {
  const store = {};
  const api = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { if (api.__fail) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    __fail: false,
    __dump: () => store
  };
  return new Proxy(api, {
    get(t, k) {
      if (k === 'getItem' || k === 'setItem' || k === 'removeItem' || k === 'clear') return t[k];
      if (k in t) return t[k];
      return store[k];
    },
    has(t, k) { return (k in t) || (k in store); },
    ownKeys() { return Reflect.ownKeys(store); },
    getOwnPropertyDescriptor(t, k) { return { value: store[k], enumerable: true, configurable: true, writable: true }; }
  });
}

const LS = makeLS();
const warnings = [];
const sandbox = { localStorage: LS, console: { log: console.log, warn: (...a) => warnings.push(a.map(String).join(' ')), error: () => {} } };
vm.createContext(sandbox);
const M = vm.runInNewContext(
  code + '\n;({Util,Store,Library,Plan,Log,Diet,Progress,Supplements,Adapt,Body});', sandbox);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n' + '='.repeat(64) + '\n' + t + '\n' + '='.repeat(64)); }

/* ---------------- V1: R1 时区 ---------------- */
section('V1  R1 时区——本地日期口径');
ok('localDate(07:30 +08:00) = 2026-09-15',
  M.Util.localDate(new Date('2026-09-15T07:30:00+08:00')) === '2026-09-15',
  M.Util.localDate(new Date('2026-09-15T07:30:00+08:00')));
ok('localDate(00:30 +08:00) = 2026-09-15',
  M.Util.localDate(new Date('2026-09-15T00:30:00+08:00')) === '2026-09-15',
  M.Util.localDate(new Date('2026-09-15T00:30:00+08:00')));
ok('localDate(23:30 +08:00) = 2026-09-15',
  M.Util.localDate(new Date('2026-09-15T23:30:00+08:00')) === '2026-09-15');
ok('对比：旧写法同输入会得到 2026-09-14',
  new Date('2026-09-15T07:30:00+08:00').toISOString().slice(0, 10) === '2026-09-14');
ok('mondayOf() 指向周一且时间归零', (() => {
  const m = M.Util.mondayOf(new Date('2026-09-15T13:00:00+08:00')); // 周二
  return m.getDay() === 1 && M.Util.localDate(m) === '2026-09-14';
})());
const liveIsoCalls = src.split('\n').filter(l => {
  const t = l.trim();
  return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) && /toISOString\(\)\.slice/.test(l);
});
console.log('  源文件「代码行」残留 toISOString: ' + liveIsoCalls.length + ' 处（注释中的说明不计）');
ok('代码中已无 toISOString().slice(0,10)', liveIsoCalls.length === 0, liveIsoCalls.join(' | '));

/* ---------------- V2: R3 normalize 防御 ---------------- */
section('V2  R3 normalize——畸形数据不再崩渲染');
const broken = M.Store.normalize({
  library: [{ id: 'a', name: '测试动作' }],      // 缺 points/errors/sets/reps/demo
  logs: [{ date: 'bad-date' }],                  // 日期非法
  metrics: [{ weight: '' }],
  diet: [{ kcal: null }]
});
ok('动作缺字段被补齐 points=[]', Array.isArray(broken.library[0].points) && broken.library[0].points.length === 0);
ok('动作缺字段被补齐 errors=[]', Array.isArray(broken.library[0].errors));
ok('动作缺字段被补齐 sets=3', broken.library[0].sets === 3);
ok('动作缺字段被补齐 reps 默认', broken.library[0].reps === '12-15');
ok('非法日期被纠正为本地日期', M.Util.isDateStr(broken.logs[0].date), broken.logs[0].date);
ok('logs[0].entries 补为空数组', Array.isArray(broken.logs[0].entries));
ok('metrics weight 空串归一为 null', broken.metrics[0].weight === null);
ok('diet kcal null 归一为 0', broken.diet[0].kcal === 0);
ok('plan.week 补全为七天', Object.keys(broken.plan.week).length === 7, Object.keys(broken.plan.week).join(','));
ok('顶层传数组不会抛错', (() => { try { M.Store.normalize([]); return true; } catch (e) { return false; } })());
ok('顶层传 null 不会抛错', (() => { try { M.Store.normalize(null); return true; } catch (e) { return false; } })());
ok('normalize 幂等（二次结果一致）',
  JSON.stringify(M.Store.normalize(broken)) === JSON.stringify(M.Store.normalize(M.Store.normalize(broken))));

/* ---------------- V3: R2 迁移按天化 ---------------- */
section('V3  R2 迁移——只升级周五，不抹除其它天自定义');
const v34Fri = ['a_leg_kbswing', 'a_leg_bulgarian', 'a_leg_curl', 'a_leg_rdl', 'a_leg_bridge', 'a_leg_calf'];
const userState = {
  profile: { age: 29, goal: '薄肌' },
  library: M.Store.DEFAULT_DATA.library,
  plan: {
    template: '用户自定义模板',
    week: {
      '周一': { type: 'push', actions: ['a_push_dbpress', 'a_push_lat'] },   // 用户自定义
      '周三': { type: 'pull', actions: ['a_pull_machine'] },                  // 用户自定义
      '周五': { type: 'legs', actions: v34Fri }                               // 仍是旧默认签名
    }
  },
  logs: [], metrics: [], diet: [], supps: [], herbs: [], releases: [], longevity: [], skincare: []
};
LS.setItem(M.Store.KEY, JSON.stringify(userState));
M.Store.load();
const after = M.Store.get();
ok('用户自定义的周一被完整保留',
  JSON.stringify(after.plan.week['周一'].actions) === JSON.stringify(['a_push_dbpress', 'a_push_lat']),
  JSON.stringify(after.plan.week['周一'].actions));
ok('用户自定义的周三被完整保留',
  JSON.stringify(after.plan.week['周三'].actions) === JSON.stringify(['a_pull_machine']));
ok('周五被升级为最新默认',
  JSON.stringify(after.plan.week['周五'].actions) === JSON.stringify(M.Store.DEFAULT_DATA.plan.week['周五'].actions));
ok('用户自定义的模板名未被覆盖', after.plan.template === '用户自定义模板', after.plan.template);
ok('迁移前已自动留档', M.Store.listBackups().some(b => b.reason === 'pre-migrate-v3.7'),
  JSON.stringify(M.Store.listBackups()));

/* ---------------- V4: R5 导入校验 ---------------- */
section('V4  R5 导入——结构非法一律拒绝，绝不静默重置');
const tryImport = t => { try { M.Store.importJSON(t); return { ok: true }; } catch (e) { return { ok: false, msg: e.message }; } };
const beforeImport = JSON.stringify(M.Store.get());
for (const bad of ['[]', '{}', 'null', '"hello"', '123', '']) {
  const r = tryImport(bad);
  ok('拒绝 ' + JSON.stringify(bad).padEnd(10) + ' → ' + (r.ok ? '未拒绝!' : r.msg.slice(0, 34)),
    !r.ok, r.ok ? '被误判为合法备份' : '');
}
ok('非法导入后数据零变化', JSON.stringify(M.Store.get()) === beforeImport);
const good = { profile: { age: 30 }, library: M.Store.DEFAULT_DATA.library, plan: M.Store.DEFAULT_DATA.plan, logs: [], metrics: [], diet: [] };
const rg = tryImport(JSON.stringify(good));
ok('合法备份导入成功', rg.ok, rg.msg || '');
ok('导入前自动留档', M.Store.listBackups().some(b => b.reason === 'pre-import'));

/* ---------------- V5: R6 内置动作删除黑名单 ---------------- */
section('V5  R6 删除内置动作——不被回灌');
M.Store.reset();
const n0 = M.Store.get().library.length;
M.Library.remove('a_leg_press');
ok('动作已从库中移除', !M.Store.get().library.some(a => a.id === 'a_leg_press'));
ok('已写入删除黑名单', (M.Store.get().removedBuiltin || []).includes('a_leg_press'));
M.Store.load();   // 模拟重新打开页面
ok('重新加载后仍不在库中（旧实现会回灌）',
  !M.Store.get().library.some(a => a.id === 'a_leg_press'),
  '库内仍有 ' + M.Store.get().library.length + ' 条（原 ' + n0 + '）');
ok('其它内置动作未被误删', M.Store.get().library.length === n0 - 1, M.Store.get().library.length + ' vs ' + (n0 - 1));

/* ---------------- V6: R6 计划悬挂引用清理 ---------------- */
section('V6  计划悬挂引用清理');
M.Store.reset();
M.Store.set(d => { d.plan.week['周一'].actions = ['a_push_dbpress', '不存在的动作id']; });
M.Store.load();
ok('指向不存在动作的引用被剔除',
  JSON.stringify(M.Store.get().plan.week['周一'].actions) === JSON.stringify(['a_push_dbpress']),
  JSON.stringify(M.Store.get().plan.week['周一'].actions));

/* ---------------- V7: R4 Progress 趋势 ---------------- */
section('V7  R4 体测趋势——null 不再参与算术');
M.Store.reset();
M.Store.set(d => {
  d.metrics = [
    { id: 'm1', date: '2026-08-01', weight: 78.0, bodyfat: 21.0, waist: 86 },
    { id: 'm2', date: '2026-09-01', weight: null, bodyfat: 19.8, waist: 84 }
  ];
});
const fbA = M.Progress.feedback();
ok('未测体重时不再输出"减脂正轨"', fbA.msg.indexOf('减脂正轨') < 0, fbA.msg.slice(0, 60));
ok('明确说明有效数据点不足', fbA.msg.indexOf('有效数据点不足') >= 0);
ok('level 降级为 warn 而非 ok', fbA.level === 'warn', fbA.level);
ok('腰围仍能正常给出 delta', fbA.msg.indexOf('腰围 86 → 84 cm') >= 0, fbA.msg);

M.Store.set(d => {
  d.metrics = [
    { id: 'm1', date: '2026-08-01', weight: null, bodyfat: 21.0, waist: null },
    { id: 'm2', date: '2026-09-01', weight: null, bodyfat: 19.8, waist: null }
  ];
});
const fbB = M.Progress.feedback();
ok('两次都未测体重时不编造"身体重组"', fbB.msg.indexOf('身体重组') < 0, fbB.msg.slice(0, 60));

M.Store.set(d => {
  d.metrics = [
    { id: 'm1', date: '2026-08-01', weight: 78.0, bodyfat: 21.0, waist: 86 },
    { id: 'm2', date: '2026-09-01', weight: 76.5, bodyfat: 19.8, waist: 84 }
  ];
});
const fbC = M.Progress.feedback();
ok('双降仍判定为减脂正轨', fbC.msg.indexOf('减脂正轨') >= 0, fbC.msg.slice(0, 60));
ok('输出可对账的数值区间', fbC.msg.indexOf('78 → 76.5 kg') >= 0, fbC.msg.slice(0, 120));

/* ---------------- V8: R10 饮食空判定 ---------------- */
section('V8  R10 饮食匹配——不再产生绿色空提示');
M.Store.reset();
const m1 = M.Diet.match({ date: '2026-09-15', kcal: 0, protein: 130, flags: [] });
ok('kcal=0 时不再是 ok level', m1.level !== 'ok', m1.level);
ok('kcal=0 时消息非空', m1.msg.length > 0, JSON.stringify(m1.msg));
ok('kcal=0 时明确提示"热量未填写"', m1.msg.indexOf('热量未填写') >= 0, m1.msg);
const m2 = M.Diet.match({ date: '2026-09-15', kcal: 1500, protein: 130, flags: [] });
ok('热量不足仍报"摄入偏低"', m2.msg.indexOf('摄入偏低') >= 0, m2.msg);
const m3 = M.Diet.match({ date: '2026-09-15', kcal: 2000, protein: 130, flags: [] });
ok('达标时给出达标判定（无训练记录→休息日口径）', m3.msg.indexOf('达标') >= 0 && m3.level === 'ok', m3.msg);
// 补一条：当日有训练记录时应走训练日口径（蛋白门槛 120g）
M.Store.set(d => { d.logs = [{ id: 'L1', date: '2026-09-15', dayType: 'push', entries: [], rating: 8, recovery: '' }]; });
const m4 = M.Diet.match({ date: '2026-09-15', kcal: 2000, protein: 130, flags: [] });
ok('有训练记录时走训练日口径', m4.isTrain === true && m4.msg.indexOf('训练日') >= 0, m4.msg);
ok('任何输入下 msg 均非空', [m1, m2, m3, m4].every(x => x.msg.length > 0));

/* ---------------- V9: R7 写入失败可见 ---------------- */
section('V9  R7 持久化失败——不再静默');
LS.__fail = true;
const okSave = M.Store.set(d => { d.profile.goal = 'x'; });
ok('写入失败时 set() 返回 false', okSave === false, String(okSave));
ok('写入失败时产生可读错误信息', !!M.Store.getLastError(), M.Store.getLastError());
console.log('  错误文案: ' + M.Store.getLastError());
ok('写入失败时向控制台记录了原因', warnings.some(w => /QuotaExceededError|quota/.test(w)), warnings.slice(-1)[0]);
LS.__fail = false;
ok('恢复后写入成功且错误清空', M.Store.set(d => { d.profile.goal = '薄肌 (降体脂保肌)'; }) === true && !M.Store.getLastError());

/* ---------------- V10: 损坏数据抢救 ---------------- */
section('V10  存储损坏——原始串另存，不静默丢弃');
LS.setItem(M.Store.KEY, '{坏掉的 JSON');
M.Store.load();
ok('损坏时回退默认数据', Array.isArray(M.Store.get().library) && M.Store.get().library.length > 0);
ok('原始内容被另存到 .corrupt', LS.getItem(M.Store.KEY + '.corrupt') === '{坏掉的 JSON');
ok('产出加载警告文案', !!M.Store.getLoadWarning(), M.Store.getLoadWarning());
M.Store.clearLoadWarning();
ok('清除后警告消失', !M.Store.getLoadWarning());

/* ---------------- V11: Adapt 自适应引擎（头号卖点，表驱动六态） ---------------- */
section('V11  Adapt 自适应引擎——六态规则 + 周容量');
const AD = M.Adapt;
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return M.Util.localDate(d); };
const mkLog = (date, w, r) => ({ id: 'l_' + date, date, dayType: 'push',
  entries: [{ actionId: 'a_push_dbpress', actionName: '哑铃卧推', sets: [{ weight: w, reps: r }] }] });
// ① 首练（无历史）
{
  const s = AD.suggestion('a_push_dbpress');
  ok('① 首练：kind=first 且带预设组次提示', s.kind === 'first' && /首练/.test(s.msg), s.msg);
}
// ② 优于前高 → +2.5% 上探（50×10 vs 45×10：e1RM 50*(1+10/30)≈66+ > 45*(1.333)≈60 → 上探）
// 注意 round05 语义：50*1.025=51.2499…（浮点）→ *2=102.4999 → round=102 → 51kg
M.Store.set(d => { d.logs = [mkLog(dayOffset(-7), 45, 10), mkLog(dayOffset(-1), 50, 10)]; });
{
  const s = AD.suggestion('a_push_dbpress');
  ok('② 优于前高 → +2.5% 上探 50→51kg', s.kind === 'plan' && s.target === 51 && /上探/.test(s.msg), 'target=' + s.target + ' | ' + s.msg);
}
// ③ 稳定（持平）→ 维持
M.Store.set(d => { d.logs = [mkLog(dayOffset(-7), 50, 10), mkLog(dayOffset(-1), 50, 10)]; });
{
  const s = AD.suggestion('a_push_dbpress');
  ok('③ 持平 → 维持 50kg', s.kind === 'plan' && s.target === 50 && /维持/.test(s.msg), 'target=' + s.target + ' | ' + s.msg);
}
// ④ 未达前高 → 维持 + 质量提示
M.Store.set(d => { d.logs = [mkLog(dayOffset(-7), 52, 10), mkLog(dayOffset(-1), 48, 10)]; });
{
  const s = AD.suggestion('a_push_dbpress');
  ok('④ 未达前高 → 维持 48kg 且提示做满质量', s.kind === 'plan' && s.target === 48 && /未达前高/.test(s.msg), 'target=' + s.target + ' | ' + s.msg);
}
// ⑤ 单条记录 → 维持建立基准
M.Store.set(d => { d.logs = [mkLog(dayOffset(-1), 50, 10)]; });
{
  const s = AD.suggestion('a_push_dbpress');
  ok('⑤ 仅一条记录 → 维持 50kg 建立基准', s.kind === 'plan' && s.target === 50 && /基准/.test(s.msg), 'target=' + s.target + ' | ' + s.msg);
}
// ⑥ 5 天回归 → 恢复性回归（gapDays>=5，覆盖 why）
M.Store.set(d => { d.logs = [mkLog(dayOffset(-8), 45, 10), mkLog(dayOffset(-6), 50, 10)]; });
{
  const s = AD.suggestion('a_push_dbpress');
  ok('⑥ 6 天未练 → 恢复性回归文案', s.kind === 'plan' && /恢复性回归/.test(s.msg), s.msg);
}
// ⑦ 睡眠 <6h → -10%（51×0.9=45.9 → round05=46kg）
M.Store.set(d => {
  d.logs = [mkLog(dayOffset(-7), 45, 10), mkLog(dayOffset(-1), 50, 10)];
  d.sleep = [{ id: 's1', date: dayOffset(0), hours: 5, quality: 3, bedtime: '01:00' }];
});
{
  const s = AD.suggestion('a_push_dbpress');
  ok('⑦ 昨夜睡眠 5h → 51 再下调 10% 至 46kg', s.kind === 'plan' && s.target === 46 && /已下调 10%/.test(s.msg), 'target=' + s.target + ' | ' + s.msg);
}
// ⑧ 周容量：本周 2 次卧推（3 组/次）→ chest=6 组
M.Store.set(d => {
  d.logs = [0, 1].map(i => ({ id: 'w' + i, date: dayOffset(-i), dayType: 'push',
    entries: [{ actionId: 'a_push_dbpress', actionName: '哑铃卧推', sets: [{ weight: 40, reps: 12 }, { weight: 40, reps: 12 }, { weight: 40, reps: 12 }] }] }));
  d.sleep = [];
});
{
  const wv = AD.weekVolume();
  const chest = wv.find(g => g.key === 'chest');
  ok('⑧ 周容量 chest=6 组（2 次×3 组，最近 7 天窗口）', !!chest && chest.sets === 6, JSON.stringify(chest));
}
// ⑨ muscleOf 归类抽查（新增的硬拉/深蹲类必须归 legs 而非 other；用真实 muscles 字段）
ok('⑨ muscleOf：杠铃硬拉→legs、杠铃深蹲→legs、平板→core、壶铃摆动→legs、八段锦→flex',
   AD.muscleOf({ name: '杠铃硬拉', muscles: '腘绳+臀+竖脊肌(后链)' }) === 'legs' &&
   AD.muscleOf({ name: '杠铃深蹲', muscles: '股四+臀+核心(全身)' }) === 'legs' &&
   AD.muscleOf({ name: '平板支撑', muscles: '核心' }) === 'core' &&
   AD.muscleOf({ name: '壶铃摆动', muscles: '臀+腘绳肌爆发(髋发力)' }) === 'legs' &&
   AD.muscleOf({ name: '八段锦', muscles: '气血/柔韧' }) === 'flex');

console.log('\n' + '='.repeat(64));
console.log('逻辑层回归结果：  PASS ' + pass + '   FAIL ' + fail);
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
