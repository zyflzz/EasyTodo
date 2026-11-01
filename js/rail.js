/* ============================================================
   EasyTodo · rail.js
   双翼侧栏（≥1400px 宽屏显示，窄屏自动隐藏、零功能损失）
   · 左栏「日历导航」：常驻迷你月历，每日计数一目了然，
     点击任意日期跳转当前视图，支持翻月浏览与回到今天
   · 右栏「今日概览」：固定以「今天」为锚点 —— 完成进度环 +
     过去未完成速清（单条/全部移到今天；统计数字留在数据面板，不做重复）
   与主视图解耦：仅依赖 ET.utils / ET.store / ET.nav 公共 API
   ============================================================ */
window.ET = window.ET || {};

ET.rail = (function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;

  /* 「移到今天」图标：右箭头入栏（与日视图顺延图标同款） */
  const ARROW = '<svg viewBox="0 0 24 24"><path d="M3.5 12h11"/><path d="M10.5 8l4 4-4 4"/><path d="M19 5.5v13"/></svg>';

  let leftEl = null;
  let rightEl = null;
  let lastState = null;

  /* 左栏日历浏览的月份：翻月后与主视图解耦；主视图换月时自动跟随 */
  let browseYm = null;
  let lastMainYm = null;

  function init() {
    leftEl = document.getElementById('rail-left');
    rightEl = document.getElementById('rail-right');
    /* 窗口跨越 1400px 断点时补一次渲染（窄屏期间一直跳过计算） */
    const mq = matchMedia('(min-width: 1400px)');
    const onChange = () => { if (lastState) renderAll(lastState); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------- 42 格月历计算（周一起始，含前后月补位）——标题跳转弹层共用 ---------- */
  function monthCells(ym) {
    const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const nDays = new Date(y, m, 0).getDate();
    const prevYm = U.addMonths(ym + '-01', -1).slice(0, 7);
    const nextYm = U.addMonths(ym + '-01', 1).slice(0, 7);
    const prevN = new Date(y, m - 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dnum = i - firstDow + 1;
      if (dnum < 1) cells.push({ ds: prevYm + '-' + U.pad(prevN + dnum), num: prevN + dnum, other: true });
      else if (dnum > nDays) cells.push({ ds: nextYm + '-' + U.pad(dnum - nDays), num: dnum - nDays, other: true });
      else cells.push({ ds: ym + '-' + U.pad(dnum), num: dnum, other: false });
    }
    return cells;
  }

  const shiftYm = (ym, delta) => U.addMonths(ym + '-01', delta).slice(0, 7);

  /* ---------- 左栏：日历导航 ---------- */
  function renderLeft(state) {
    const mainYm = state.date.slice(0, 7);
    if (browseYm === null || lastMainYm !== mainYm) browseYm = mainYm;
    lastMainYm = mainYm;

    const y = +browseYm.slice(0, 4), m = +browseYm.slice(5, 7);
    const today = U.today();
    /* 仅日视图高亮精确选中日；周/月/年视图的锚点是周期起点，不高亮以免误导 */
    const sel = state.view === 'day' ? state.date : null;

    const cells = monthCells(browseYm).map((c) => {
      const cnt = S.countByDate(c.ds);
      const all = cnt.n > 0 && cnt.done === cnt.n;
      return U.h('button', {
        type: 'button',
        class: 'rc' + (c.other ? ' other' : '') +
          (c.ds === today ? ' today' : '') + (sel === c.ds ? ' sel' : ''),
        title: U.fmtDay(c.ds) + (cnt.n ? ' · ' + cnt.n + ' 件' + (cnt.done ? '（完成 ' + cnt.done + '）' : '') : ''),
        'aria-label': '跳转到' + U.fmtDay(c.ds),
        onclick: () => ET.nav.to(state.view, c.ds)
      },
        String(c.num),
        cnt.n ? U.h('i', { class: all ? 'part' : '' }) : null);
    });

    /* 月脚注：本月件数与完成数（区间查询一次取齐） */
    const monthArr = S.forRange(browseYm + '-01', browseYm + '-' + U.pad(new Date(y, m, 0).getDate()));
    let mDone = 0;
    for (const t of monthArr) if (t.done) mDone++;

    leftEl.replaceChildren(
      U.h('section', { class: 'rail-card' },
        U.h('div', { class: 'cal-head' },
          U.h('button', {
            type: 'button', class: 'cal-nav', 'aria-label': '上一月',
            onclick: () => { browseYm = shiftYm(browseYm, -1); renderLeft(state); }
          }, '‹'),
          U.h('span', { class: 'cal-title' }, y + ' 年 ' + m + ' 月'),
          U.h('button', {
            type: 'button', class: 'cal-nav', 'aria-label': '下一月',
            onclick: () => { browseYm = shiftYm(browseYm, 1); renderLeft(state); }
          }, '›')),
        U.h('div', { class: 'cal-weeks' },
          ['一', '二', '三', '四', '五', '六', '日'].map((w) => U.h('span', null, w))),
        U.h('div', { class: 'cal-grid' }, cells),
        U.h('div', { class: 'cal-foot' },
          U.h('span', { class: 'cal-sum' },
            monthArr.length ? '本月 ' + monthArr.length + ' 件 · 完成 ' + mDone + ' 件' : '本月暂无待办'),
          U.h('button', {
            type: 'button', class: 'cal-now', title: '回到今天（日历跟随主视图）',
            onclick: () => ET.nav.today()
          }, '今天'))));
  }

  /* ---------- 右栏：今日概览 ---------- */
  function renderRight() {
    const today = U.today();
    const d = U.parseDate(today);
    const cnt = S.countByDate(today);
    const pct = cnt.n ? Math.round(cnt.done / cnt.n * 100) : 0;

    const kids = [U.h('section', { class: 'rail-card' },
      U.h('div', { class: 'ov-head' },
        U.h('span', { class: 'ov-title' }, '今日概览'),
        U.h('span', { class: 'ov-date' }, (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + U.weekday(today))),
      U.h('div', { class: 'ring-wrap' },
        U.h('div', {
          class: 'ring', style: '--p:' + pct, role: 'img',
          'aria-label': cnt.n ? '今日完成 ' + cnt.done + ' / ' + cnt.n : '今天暂无待办'
        },
          U.h('div', { class: 'ring-in' },
            U.h('b', null, cnt.n ? pct + '%' : '—'),
            U.h('span', null, cnt.n ? cnt.done + ' / ' + cnt.n : '暂无待办')))),
      cnt.n === 0
        ? U.h('button', {
            type: 'button', class: 'ov-add',
            onclick: () => ET.nav.to('day', today, true)
          }, '＋ 添加今天的待办')
        : null)];

    /* 过去未完成速清（按日期降序，近的在前） */
    const od = S.pendingBefore(today);
    if (od.length) {
      const LIMIT = 4;
      kids.push(U.h('section', { class: 'rail-card' },
        U.h('div', { class: 'rail-sub' }, '过去未完成 · ' + od.length),
        U.h('ul', { class: 'r-od' }, od.slice(0, LIMIT).map((t) =>
          U.h('li', { class: 'r-od-item' },
            U.h('button', {
              type: 'button', class: 'r-od-goto',
              title: '查看 ' + U.fmtDay(t.date),
              onclick: () => ET.nav.to('day', t.date)
            },
              U.h('span', { class: 'r-od-date' }, U.fmtDay(t.date) + ' ' + U.weekShort(t.date)),
              U.h('span', { class: 'r-od-t' }, t.title)),
            U.h('button', {
              type: 'button', class: 'r-od-move', title: '移到今天',
              'aria-label': '移到今天：' + t.title,
              onclick: () => moveOne(t, today)
            }, U.svgEl(ARROW))))),
        U.h('div', { class: 'r-od-foot' },
          U.h('button', {
            type: 'button', class: 'pill-btn r-od-all',
            title: '把所有过去未完成的待办移到今天（可撤销）',
            onclick: () => moveAll(today)
          }, '全部移到今天'),
          od.length > LIMIT
            ? U.h('button', {
                type: 'button', class: 'r-od-more', title: '回到今天视图查看全部',
                onclick: () => ET.nav.to('day', today)
              }, '还有 ' + (od.length - LIMIT) + ' 条…')
            : null)));
    }

    rightEl.replaceChildren(...kids);
  }

  /* ---------- 行动：移到今天（只改归属日期，带撤销） ---------- */
  function moveOne(t, today) {
    const from = t.date;
    S.moveTo(t.id, today);
    ET.app.refresh();
    U.toast('已移到今天', '撤销', () => { S.moveTo(t.id, from); ET.app.refresh(); });
  }

  function moveAll(today) {
    const od = S.pendingBefore(today);
    if (!od.length) return;
    const moved = od.map((t) => ({ id: t.id, from: t.date }));
    for (const m of moved) S.moveTo(m.id, today);
    ET.app.refresh();
    U.toast('已把 ' + moved.length + ' 条未完成移到今天', '撤销', () => {
      for (const m of moved) S.moveTo(m.id, m.from);
      ET.app.refresh();
    });
  }

  function renderAll(state) {
    lastState = state;
    if (!leftEl || !rightEl) return;
    /* 窄屏下侧栏 display:none（offsetParent 为空），跳过全部计算 */
    if (leftEl.offsetParent === null) return;
    renderLeft(state);
    renderRight();
  }

  return { init: init, renderAll: renderAll, monthCells: monthCells };
})();
