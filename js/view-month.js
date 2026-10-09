/* ============================================================
   EasyTodo · view-month.js
   月视图：6×7 网格，格子内最多 3 条预览，点击跳日视图
   ============================================================ */
window.ET = window.ET || {};
ET.views = ET.views || {};

ET.views.month = (function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;

  const colorOf = (id) => 'var(--c' + (U.hash(id) % 6 + 1) + ')';

  function render(root, state) {
    root.className = 'view view-month';

    const first = state.date.slice(0, 7) + '-01';
    const start = U.weekStart(first);
    const today = U.today();
    const monthTag = first.slice(0, 7);

    /* 一次性按日期分组（日期桶区间查询，避免 42 次全量过滤） */
    const map = Object.create(null);
    const end = U.addDays(start, 41);
    for (const t of S.forRange(start, end)) {
      (map[t.date] || (map[t.date] = [])).push(t);
    }

    const weekdays = U.h('div', { class: 'weekdays' },
      ...U.WEEK_SHORT.map((w) => U.h('span', null, w)));

    const grid = U.h('div', { class: 'month' });

    for (let i = 0; i < 42; i++) {
      const d = U.addDays(start, i);
      const items = (map[d] || []).slice().sort((a, b) =>
        a.done !== b.done ? (a.done ? 1 : -1) : a.createdAt - b.createdAt);
      const inMonth = d.slice(0, 7) === monthTag;
      const num = U.parseDate(d).getDate();

      const chips = items.slice(0, 3).map((it) =>
        U.h('div', { class: 'mchip' + (it.done ? ' done' : ''), style: '--cc:' + colorOf(it.id) },
          U.h('i'), U.h('span', null, it.title)));

      const dots = items.slice(0, 6).map((it) =>
        U.h('i', { style: '--cc:' + colorOf(it.id) }));

      const more = items.length - 3;

      const cell = U.h('div', {
        class: 'mcell' + (inMonth ? '' : ' out') + (d === today ? ' today' : ''),
        role: 'button',
        tabindex: '0',
        'aria-label': U.fmtDay(d) + (items.length ? '，' + items.length + ' 项待办' : ''),
        onclick: () => ET.nav.to('day', d),
        onkeydown: (e) => { if (e.key === 'Enter') ET.nav.to('day', d); }
      },
        U.h('div', { class: 'mcell-top' },
          U.h('span', { class: 'mnum' }, String(num)),
          more > 0 ? U.h('span', { class: 'mmore' }, '+' + more) : null),
        U.h('div', { class: 'mchips' }, chips),
        U.h('div', { class: 'mdots' }, dots));

      grid.append(cell);
    }

    root.replaceChildren(weekdays, grid);
  }

  return { render: render };
})();
