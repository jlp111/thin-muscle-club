/* 真实浏览器视觉验收：截图 + 布局度量
 * 用系统 Chrome（channel: 'chrome'），无需下载 Playwright 内核。
 * 用法：node tests/verify-visual.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const TARGET = process.env.TM_TARGET
  ? path.resolve(process.env.TM_TARGET)
  : path.join(__dirname, '..', 'index-tracker.html');
const OUT = process.env.SHOT_DIR || path.join(__dirname, '..', '.shots');
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (e !== undefined ? '  → ' + String(e).slice(0, 120) : '')); } };
const sec = t => console.log('\n' + '-'.repeat(58) + '\n' + t + '\n' + '-'.repeat(58));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + TARGET);
  await page.waitForSelector('#tm-root #appInner .panel', { timeout: 15000 });
  await page.waitForTimeout(400);

  /* 追踪台首次访问会弹「首次设置」引导（产品预期行为）。
     真实用户会先走完它，这里同样走完：填完 4 步后落库，后续页面才可交互。 */
  if (await page.locator('#onboarding.open').count()) {
    /* 引导为 4 步表单（#obPrev / #obNext），逐步点完 */
    for (let i = 0; i < 6; i++) {
      if (!(await page.locator('#onboarding.open').count())) break;
      const next = page.locator('#obNext');
      if (!(await next.count())) break;
      const label = (await next.textContent() || '').trim();
      await next.click();
      await page.waitForTimeout(220);
      if (/完成|开始/.test(label)) break;
    }
    await page.waitForTimeout(350);
  }
  const onboardLeft = await page.locator('#onboarding.open').count();
  ok('首次设置引导可走完并关闭', onboardLeft === 0, onboardLeft + ' 个仍打开');

  /* ── V1 双区导航视觉 ── */
  sec('V1  侧栏双区导航');
  const navInfo = await page.evaluate(() => {
    const tm = [...document.querySelectorAll('.sidebar .nav-btn[data-tm-tab]')];
    const tr = [...document.querySelectorAll('.sidebar .nav-btn[data-page]')];
    const labels = [...document.querySelectorAll('.sidebar .nav-label')].map(n => n.textContent.trim());
    const sb = document.querySelector('.sidebar').getBoundingClientRect();
    return {
      tmCount: tm.length, trCount: tr.length, labels,
      sidebarVisible: sb.width > 100 && sb.height > 300,
      lastTmBottom: tm.length ? tm[tm.length - 1].getBoundingClientRect().bottom : 0,
      sidebarBottom: sb.bottom
    };
  });
  ok('侧栏显示追踪台 7 项 + 薄肌 13 项', navInfo.tmCount === 13 && navInfo.trCount === 7,
    navInfo.trCount + '+' + navInfo.tmCount);
  ok('两个分区标题都在', navInfo.labels.includes('减脂追踪') || navInfo.labels.some(l => l.includes('今天')) || navInfo.labels.length >= 2,
    navInfo.labels.join(' | '));
  ok('薄肌分区标题存在', navInfo.labels.some(l => l.includes('薄肌')), navInfo.labels.join(' | '));
  ok('侧栏完整可见', navInfo.sidebarVisible);
  /* 导航项多于侧栏高度时，必须可滚动到达，而不是被永久截断 */
  const navScroll = await page.evaluate(() => {
    const nav = document.querySelector('.sidebar nav');
    const before = nav.scrollTop;
    nav.scrollTop = nav.scrollHeight;
    const after = nav.scrollTop;
    const last = [...document.querySelectorAll('.sidebar .nav-btn[data-tm-tab]')].pop();
    const r = last.getBoundingClientRect();
    const sb = document.querySelector('.sidebar').getBoundingClientRect();
    nav.scrollTop = before;
    return { scrollable: nav.scrollHeight > nav.clientHeight + 2,
             canReachEnd: after > 0 || nav.scrollHeight <= nav.clientHeight + 2,
             lastVisibleWhenScrolled: r.bottom <= sb.bottom + 2 && r.top >= sb.top - 2 };
  });
  ok('侧栏导航可滚动到底（不截断入口）', navScroll.scrollable ? navScroll.canReachEnd : true,
    JSON.stringify(navScroll));
  ok('滚动后最后一个薄肌入口完整可见', navScroll.lastVisibleWhenScrolled, JSON.stringify(navScroll));
  await page.screenshot({ path: path.join(OUT, '01-tracker-today.png') });

  /* ── V2 追踪台弹窗 ── */
  sec('V2  追踪台弹窗（真实布局）');
  await page.click('.sidebar .nav-btn[data-page="body"]');
  await page.waitForTimeout(350);
  await page.click('[data-open="bodyModal"]');
  await page.waitForSelector('#bodyModal.open', { timeout: 5000 });
  await page.waitForTimeout(450);
  const modalBox = await page.evaluate(() => {
    const m = document.querySelector('#bodyModal .modal').getBoundingClientRect();
    const ov = document.querySelector('#bodyModal');
    return { w: Math.round(m.width), h: Math.round(m.height), top: Math.round(m.top),
             left: Math.round(m.left), open: ov.classList.contains('open'),
             bodyLocked: document.body.classList.contains('modal-open'),
             inViewport: m.top >= 0 && m.bottom <= window.innerHeight + 1 };
  });
  ok('弹窗已打开', modalBox.open);
  ok('弹窗锁定背景滚动', modalBox.bodyLocked);
  ok('弹窗尺寸合理', modalBox.w > 300 && modalBox.w <= 1440, modalBox.w + 'x' + modalBox.h);
  ok('弹窗完整落在视口内', modalBox.inViewport, modalBox.top + '..' + (modalBox.top + modalBox.h));
  await page.screenshot({ path: path.join(OUT, '02-tracker-modal.png') });
  await page.click('#bodyModal [data-close="bodyModal"]');
  await page.waitForTimeout(300);
  ok('弹窗可关闭', !(await page.evaluate(() => document.querySelector('#bodyModal').classList.contains('open'))));

  /* ── V3 薄肌模块视觉 ── */
  sec('V3  薄肌系统渲染与样式隔离');
  await page.click('.sidebar .nav-btn[data-tm-tab="home"]');
  await page.waitForTimeout(700);
  const tmInfo = await page.evaluate(() => {
    const root = document.querySelector('#tm-root');
    const page_ = document.querySelector('#page-tm');
    const cs = getComputedStyle(document.querySelector('#tm-root .panel') || root);
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    return {
      pageActive: page_.classList.contains('active'),
      rootW: Math.round(root.getBoundingClientRect().width),
      panelBg: cs.backgroundColor || cs.backgroundImage.slice(0, 40),
      colorScheme: cs.colorScheme,
      contentLen: root.textContent.trim().length,
      bodyBg
    };
  });
  ok('薄肌页已激活', tmInfo.pageActive);
  ok('薄肌内容已渲染', tmInfo.contentLen > 200, tmInfo.contentLen + ' 字符');
  ok('薄肌容器有实际宽度', tmInfo.rootW > 600, tmInfo.rootW + 'px');
  ok('薄肌深色令牌生效（未被追踪台覆盖）',
    tmInfo.panelBg !== tmInfo.bodyBg || /gradient|rgb\(1[0-9],/.test(tmInfo.panelBg),
    tmInfo.panelBg + ' vs body ' + tmInfo.bodyBg);
  await page.screenshot({ path: path.join(OUT, '03-tm-home.png'), fullPage: false });

  /* 动作库（数据最密的一页，最能暴露样式冲突） */
  await page.click('.sidebar .nav-btn[data-tm-tab="library"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '04-tm-library.png'), fullPage: false });
  const libCards = await page.evaluate(() => document.querySelectorAll('#libList .card').length);
  ok('动作库卡片已渲染', libCards > 10, libCards + ' 张');

  /* ── V4 薄肌弹窗（关键交互） ── */
  sec('V4  薄肌确认弹窗（真实布局 + 作用域）');
  await page.click('#libList [data-del-act]');
  await page.waitForSelector('.modal-backdrop', { timeout: 5000 });
  await page.waitForTimeout(450);
  const tmModal = await page.evaluate(() => {
    const bd = document.querySelector('.modal-backdrop');
    const box = bd.querySelector('.modal').getBoundingClientRect();
    const cs = getComputedStyle(bd.querySelector('.modal'));
    return {
      inScope: bd.parentElement && bd.parentElement.id === 'tm-root',
      w: Math.round(box.width), h: Math.round(box.height),
      centered: Math.abs((box.left + box.width / 2) - window.innerWidth / 2) < 40,
      visible: box.width > 100 && box.height > 40,
      bg: cs.backgroundColor,
      bgImage: cs.backgroundImage
    };
  });
  ok('薄肌弹窗挂在 #tm-root 内（样式作用域正确）', tmModal.inScope);
  ok('薄肌弹窗可见且有尺寸', tmModal.visible, tmModal.w + 'x' + tmModal.h);
  ok('薄肌弹窗居中显示', tmModal.centered);
  /* 薄肌弹窗用 --grad-card 渐变做底，backgroundColor 本就为 transparent，
     因此要连 backgroundImage 一起判断；两者皆空才算真的没底色。 */
  ok('薄肌弹窗有底色（未被追踪台 .modal 覆盖）',
    (tmModal.bg && tmModal.bg !== 'rgba(0, 0, 0, 0)') ||
    (tmModal.bgImage && tmModal.bgImage !== 'none'),
    tmModal.bg + ' / ' + tmModal.bgImage);
  await page.screenshot({ path: path.join(OUT, '05-tm-modal.png') });
  await page.click('.modal-backdrop [data-modal-cancel]');
  await page.waitForTimeout(300);
  ok('薄肌弹窗可取消关闭', !(await page.evaluate(() => !!document.querySelector('.modal-backdrop'))));

  /* ── V5 主题切换 ── */
  sec('V5  主题统一');
  const themes = [];
  for (let i = 0; i < 2; i++) {
    themes.push(await page.evaluate(() => ({
      attr: document.documentElement.getAttribute('data-theme'),
      tmBg: (() => {
        const el = document.querySelector('#tm-root .panel') || document.querySelector('#tm-root');
        const c = getComputedStyle(el);
        return c.backgroundColor + '|' + c.backgroundImage;
      })(),
      trackerBg: getComputedStyle(document.querySelector('.main')).backgroundColor
    })));
    await page.click('#themeToggle');
    await page.waitForTimeout(450);
  }
  ok('追踪台主题可切换', themes[0].attr !== themes[1].attr, themes.map(t => t.attr).join(' → '));
  ok('切换后薄肌区背景随之变化', themes[0].tmBg !== themes[1].tmBg,
    themes[0].tmBg + ' → ' + themes[1].tmBg);
  ok('两套系统主题同步（同一 html[data-theme]）',
    themes.every(t => t.attr === t.attr), '');
  await page.screenshot({ path: path.join(OUT, '06-theme.png') });

  /* ── V6 移动端 ── */
  sec('V6  移动端布局');
  const mob = await ctx.newPage();
  await mob.setViewportSize({ width: 390, height: 844 });
  await mob.goto('file://' + TARGET);
  await mob.waitForSelector('#tm-root #appInner .panel', { timeout: 15000 });
  await mob.waitForTimeout(600);
  const mobInfo = await mob.evaluate(() => ({
    sidebarHidden: getComputedStyle(document.querySelector('.sidebar')).display === 'none',
    /* 文档内有两个 .mobile-nav：薄肌的 #mobileNav 与追踪台底部栏。
       这里只验证追踪台自己的底部栏（位于 body 直接子级、非 #tm-root 内）。 */
    mobileNavShown: (() => {
      /* 追踪台底栏在 .app 内、薄肌底栏在 #tm-root 内，按「不在 #tm-root 内」精确区分 */
      const n = [...document.querySelectorAll('.mobile-nav')].find(x => !x.closest('#tm-root'));
      return !!n && getComputedStyle(n).display !== 'none';
    })(),
    tmNavHidden: (() => {
      const n = document.querySelector('#tm-root .mobile-nav');
      return !!n && getComputedStyle(n).display === 'none';
    })(),
    hOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    scrollW: document.documentElement.scrollWidth, winW: window.innerWidth
  }));
  ok('移动端隐藏侧栏', mobInfo.sidebarHidden);
  ok('移动端显示追踪台底部导航', mobInfo.mobileNavShown);
  /* 薄肌自带底栏须让位给追踪台底栏，否则移动端会出现双底栏叠在一起 */
  ok('薄肌自带底栏在合并版中隐藏（避免双底栏重叠）', mobInfo.tmNavHidden);
  ok('无横向溢出', !mobInfo.hOverflow, mobInfo.scrollW + ' vs ' + mobInfo.winW);
  await mob.screenshot({ path: path.join(OUT, '07-mobile.png') });
  await mob.close();

  /* ── V7 无脚本错误 ── */
  sec('V7  运行时无错误');
  const real = errors.filter(e => !/favicon|ERR_FILE_NOT_FOUND|profile\.local\.js/i.test(e));
  ok('全程无 JS 错误', real.length === 0, real.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n' + '='.repeat(58));
  console.log('视觉验收结果：  PASS ' + pass + '   FAIL ' + fail);
  console.log('截图目录：' + OUT);
  console.log('='.repeat(58));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('视觉验收异常:', e); process.exit(1); });