/* ============================================================
   EasyTodo · view-week.js
   周视图：7 列概览，点击条目跳日视图，列尾快捷添加
   ============================================================ */
window.ET = window.ET || {};
ET.views = ET.views || {};

ET.views.week = (function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;

  const colorOf = (id) => 'var(--c' + (U.hash(id) % 6 + 1) + ')';

  function render(root, state) {
    root.className = 'view view-week';

    const start = U.weekStart(state.date);
    const today = U.today();
    const grid = U.h('div', { class: 'week', role: 'list' });

    for (let i = 0; i < 7; i++) {
      const d = U.addDays(start, i);
      const items = S.byDate(d);
      const isToday = d === today;

      const head = U.h('div', { class: 'wcol-h' },
        U.h('span', { class: 'wd' }, U.weekShort(d)),
        U.h('span', { class: 'wnum' }, String(U.parseDate(d).getDate())),
        items.length ? U.h('span', { class: 'wcnt' }, String(items.length)) : null
      );

      const body = U.h('div', { class: 'wcol-b' });
      if (!items.length) {
        body.append(U.h('div', { class: 'wcol-empty' }, '·'));
      } else {
        for (const it of items) {
          body.append(U.h('button', {
            class: 'chip' + (it.done ? ' done' : ''),
            role: 'listitem',
            title: it.title + '（点击查看）',
            style: '--cc:' + colorOf(it.id),
            onclick: () => ET.nav.to('day', d)
          }, U.h('i', { class: 'cdot' }), U.h('span', { class: 'ctext' }, it.title)));
        }
      }

      const foot = U.h('button', {
        class: 'wcol-f',
        title: '添加到 ' + U.fmtDay(d),
        onclick: () => ET.nav.to('day', d, true)
      }, '+ 添加');

      grid.append(U.h('div', { class: 'wcol' + (isToday ? ' today' : '') }, head, body, foot));
    }

    root.replaceChildren(U.h('div', { class: 'week-scroller' }, grid));
  }

  return { render: render };
})();
