/* ============================================================
   EasyTodo · view-year.js
   年视图：12 个迷你月历，热力格标注待办密度，点击跳日视图
   ============================================================ */
window.ET = window.ET || {};
ET.views = ET.views || {};

ET.views.year = (function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;

  function render(root, state) {
    root.className = 'view view-year';

    const year = state.date.slice(0, 4);
    const today = U.today();

    /* 该年每日计数（日期桶区间查询，单次遍历） */
    const counts = Object.create(null);
    for (const t of S.forRange(year + '-01-01', year + '-12-31')) {
      counts[t.date] = (counts[t.date] || 0) + 1;
    }

    const grid = U.h('div', { class: 'year-grid' });

    for (let m = 0; m < 12; m++) {
      const mm = U.pad(m + 1);
      const first = year + '-' + mm + '-01';
      const dim = U.daysInMonth(+year, m);
      const offset = (U.parseDate(first).getDay() + 6) % 7; /* 周一起始 */

      let monthTotal = 0;
      const cells = [];

      for (let i = 0; i < offset; i++) cells.push(U.h('i', { class: 'ym-d blank' }));

      for (let d = 1; d <= dim; d++) {
        const ds = year + '-' + mm + '-' + U.pad(d);
        const n = counts[ds] || 0;
        monthTotal += n;
        cells.push(U.h('button', {
          class: 'ym-d' + (ds === today ? ' today' : ''),
          'data-l': n >= 3 ? 3 : n,
          'aria-label': (m + 1) + '月' + d + '日' + (n ? '，' + n + ' 项待办' : ''),
          title: (m + 1) + '月' + d + '日' + (n ? ' · ' + n + ' 项' : ''),
          onclick: () => ET.nav.to('day', ds)
        }));
      }

      grid.append(U.h('section', { class: 'ym' },
        U.h('button', {
          class: 'ym-h',
          title: '查看 ' + (m + 1) + ' 月',
          onclick: () => ET.nav.to('month', first)
        },
          U.h('span', { class: 'ym-name' }, (m + 1) + '月'),
          U.h('span', { class: 'ym-count' }, monthTotal ? monthTotal + ' 项' : '')),
        U.h('div', { class: 'ym-dots' }, cells)));
    }

    root.replaceChildren(grid);
  }

  return { render: render };
})();
