/* ============================================================
   EasyTodo · view-day.js
   日视图：清单增删改查 · 勾选完成（置灰+删除线+移至末尾）
   ============================================================ */
window.ET = window.ET || {};
ET.views = ET.views || {};

ET.views.day = (function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;

  let rootEl = null;
  let listInner = null;
  let addInput = null;
  let metaEl = null;
  let currentDate = null;

  const ICONS = {
    check: '<svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 12.1A1.9 1.9 0 0 0 9.3 21h5.4a1.9 1.9 0 0 0 1.9-1.9L17.5 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    empty: '<svg viewBox="0 0 64 64"><rect x="14" y="10" width="36" height="44" rx="9"/><path d="M24 26h16M24 34h16M24 42h9"/></svg>'
  };

  const colorOf = (id) => 'var(--c' + (U.hash(id) % 6 + 1) + ')';

  /* ---------- 渲染入口 ---------- */
  function render(root, state) {
    rootEl = root;
    currentDate = state.date;
    root.className = 'view view-day';
    root.replaceChildren(buildMeta(), buildAdd(), buildList());
    refreshMeta();
  }

  /* ---------- 进度条 ---------- */
  function buildMeta() {
    metaEl = U.h('div', { class: 'day-meta', hidden: true },
      U.h('span', { class: 'num' }),
      U.h('div', { class: 'progress' }, U.h('i')));
    return metaEl;
  }

  function refreshMeta() {
    const { n, done } = S.countByDate(currentDate);
    if (n === 0) { metaEl.hidden = true; return; }
    metaEl.hidden = false;
    metaEl.querySelector('.num').textContent = '已完成 ' + done + '/' + n;
    metaEl.querySelector('.progress > i').style.width = (n ? Math.round(done / n * 100) : 0) + '%';
  }

  /* ---------- 添加 ---------- */
  function buildAdd() {
    addInput = U.h('input', {
      type: 'text',
      maxlength: 120,
      'aria-label': '新增待办',
      placeholder: placeholderFor(currentDate)
    });
    addInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.stopPropagation();
      submitAdd();
    });
    const btn = U.h('button', {
      class: 'add-btn',
      'aria-label': '添加待办',
      title: '添加（Enter）',
      onclick: () => { submitAdd(); addInput.focus(); }
    }, U.svgEl(ICONS.plus));

    return U.h('div', { class: 'card add-card' }, addInput, btn);
  }

  function placeholderFor(date) {
    return date === U.today() ? '要做什么？回车添加' : '为 ' + U.fmtDay(date) + ' 添加待办';
  }

  function submitAdd() {
    const title = addInput.value.trim();
    if (!title) {
      const card = addInput.closest('.add-card');
      card.classList.remove('shake');
      void card.offsetWidth;
      card.classList.add('shake');
      return;
    }
    const t = S.add(currentDate, title);
    addInput.value = '';
    refreshList(false);
    /* 新条目滑入 */
    requestAnimationFrame(() => {
      const el = listInner.querySelector('[data-flip-id="' + t.id + '"]');
      if (el && U.motionOK()) el.classList.add('item-in');
    });
  }

  /* ---------- 列表 ---------- */
  function buildList() {
    const card = U.h('section', { class: 'card list-card', 'aria-label': '待办清单' });
    listInner = U.h('ul', { class: 'list' });
    card.append(listInner);
    renderItems();
    return card;
  }

  function renderItems() {
    const items = S.byDate(currentDate);
    if (!items.length) {
      const isToday = currentDate === U.today();
      listInner.replaceChildren(U.h('li', { class: 'empty' },
        U.svgEl(ICONS.empty),
        U.h('p', { class: 't1' }, isToday ? '今天还没有待办' : '这一天还没有安排'),
        U.h('p', { class: 't2' }, isToday ? '享受当下，或从上方添加一条' : '点击上方输入框，为这一天做点计划')));
      return;
    }
    const doneCount = items.filter((t) => t.done).length;
    const nodes = [];
    let dividerDone = false;
    for (const t of items) {
      if (t.done && !dividerDone && doneCount < items.length) {
        nodes.push(U.h('li', { class: 'group-label' }, '已完成 · ' + doneCount));
        dividerDone = true;
      }
      nodes.push(itemEl(t));
    }
    listInner.replaceChildren(...nodes);
  }

  function itemEl(t) {
    const check = U.h('button', {
      class: 'check',
      role: 'checkbox',
      'aria-checked': String(t.done),
      'aria-label': t.done ? '标记为未完成' : '标记为已完成',
      onclick: () => toggleItem(t.id)
    }, U.svgEl(ICONS.check));

    const title = U.h('span', {
      class: 'title',
      title: '双击编辑',
      ondblclick: () => startEdit(row, t)
    }, t.title);

    const editBtn = U.h('button', {
      class: 'mini-btn', 'aria-label': '编辑', title: '编辑',
      onclick: () => startEdit(row, t)
    }, U.svgEl(ICONS.pencil));

    const delBtn = U.h('button', {
      class: 'mini-btn danger', 'aria-label': '删除', title: '删除',
      onclick: () => removeItem(row, t)
    }, U.svgEl(ICONS.trash));

    const row = U.h('li', {
      class: 'todo' + (t.done ? ' done' : ''),
      dataset: { id: t.id, flipId: t.id },
      style: '--cc:' + colorOf(t.id)
    }, U.h('i', { class: 'tick' }), check, title, U.h('span', { class: 'acts' }, editBtn, delBtn));

    return row;
  }

  /* 整体刷新列表（flip=true 时对已有条目做位移动画） */
  function refreshList(flip) {
    if (!listInner) return;
    if (flip && U.motionOK()) {
      U.flip(listInner, renderItems);
    } else {
      renderItems();
    }
    refreshMeta();
  }

  /* ---------- 勾选完成 ---------- */
  function toggleItem(id) {
    const t = S.toggle(id);
    /* 记录勾选框位置（重排前），用于喝彩动画起点 */
    let x = innerWidth / 2, y = innerHeight / 2;
    const check = listInner && listInner.querySelector('[data-flip-id="' + id + '"] .check');
    if (check) {
      const r = check.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    if (t && t.done) {
      const items = S.byDate(currentDate);
      const allDone = items.length > 0 && items.every((it) => it.done);
      U.celebrate(x, y, allDone);
    }
    refreshList(true);
  }

  /* ---------- 删除（折叠动画 + 可撤销） ---------- */
  function removeItem(row, t) {
    row.style.height = row.offsetHeight + 'px';
    void row.offsetWidth; /* 强制回流，确保过渡生效 */
    row.classList.add('leaving');
    setTimeout(() => {
      const removed = S.remove(t.id);
      refreshList(false);
      if (removed) {
        U.toast('已删除「' + t.title + '」', '撤销', () => {
          S.restore(removed);
          if (ET.app && ET.app.refresh) ET.app.refresh();
        });
      }
    }, 250);
  }

  /* ---------- 行内编辑 ---------- */
  function startEdit(row, t) {
    if (row.querySelector('.edit-input')) return;
    const span = row.querySelector('.title');
    if (!span) return;
    const input = U.h('input', {
      class: 'edit-input',
      value: t.title,
      maxlength: 120,
      'aria-label': '编辑待办'
    });
    span.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const commit = (save) => {
      if (finished) return;
      finished = true;
      if (save) {
        const v = input.value.trim();
        if (v && v !== t.title) {
          S.rename(t.id, v);
          refreshList(false);
          return;
        }
      }
      refreshList(false);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') commit(true);
      else if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
  }

  /* ---------- 供外部调用 ---------- */
  function focusAdd() {
    if (addInput) addInput.focus();
  }

  return { render: render, focusAdd: focusAdd };
})();
