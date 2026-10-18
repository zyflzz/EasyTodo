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
  let isPast = false; /* 当前查看的日期是否在过去（可顺延未完成到今天） */
  let backfill = false; /* 补记模式：允许为过去补录已完成待办并手动指定时间 */

  const ICONS = {
    check: '<svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 8"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3Z"/><path d="M13.5 6.5l3 3"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 12.1A1.9 1.9 0 0 0 9.3 21h5.4a1.9 1.9 0 0 0 1.9-1.9L17.5 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    moveToday: '<svg viewBox="0 0 24 24"><path d="M3.5 12h11"/><path d="M10.5 8l4 4-4 4"/><path d="M19 5.5v13"/></svg>',
    empty: '<svg viewBox="0 0 64 64"><rect x="14" y="10" width="36" height="44" rx="9"/><path d="M24 26h16M24 34h16M24 42h9"/></svg>'
  };

  const colorOf = (id) => 'var(--c' + (U.hash(id) % 6 + 1) + ')';

  /* ---------- 渲染入口 ---------- */
  function render(root, state) {
    rootEl = root;
    currentDate = state.date;
    isPast = currentDate < U.today();
    root.className = 'view view-day';
    root.replaceChildren(buildMeta(), buildAdd(), buildList());
    refreshMeta();
  }

  /* ---------- 进度条 ---------- */
  function buildMeta() {
    metaEl = U.h('div', { class: 'day-meta', hidden: true },
      U.h('span', { class: 'num' }),
      U.h('div', { class: 'progress' }, U.h('i')),
      U.h('button', {
        class: 'pill-btn carry-btn', hidden: true,
        title: '把这一天未完成的待办移到今天（创建时间保持不变）',
        onclick: movePendingToday
      }));
    return metaEl;
  }

  function refreshMeta() {
    const { n, done } = S.countByDate(currentDate);
    if (n === 0) { metaEl.hidden = true; return; }
    metaEl.hidden = false;
    metaEl.querySelector('.num').textContent = '已完成 ' + done + '/' + n;
    metaEl.querySelector('.progress > i').style.width = (n ? Math.round(done / n * 100) : 0) + '%';
    /* 过去日期且有未完成：显示一键顺延按钮 */
    const btn = metaEl.querySelector('.carry-btn');
    if (btn) {
      const pending = n - done;
      btn.hidden = !(isPast && pending > 0);
      if (!btn.hidden) btn.textContent = '未完成移到今天 (' + pending + ')';
    }
  }

  /* ---------- 添加 ---------- */
  function buildAdd() {
    const locked = isPast && !backfill;
    addInput = U.h('input', {
      type: 'text',
      maxlength: 120,
      'aria-label': '新增待办',
      placeholder: addPlaceholder(),
      disabled: locked || null
    });
    addInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.stopPropagation();
      submitAdd();
    });
    const btn = U.h('button', {
      class: 'add-btn',
      'aria-label': '添加待办',
      title: locked ? '过去的日期不能新增待办' : '添加（Enter）',
      onclick: () => { submitAdd(); addInput.focus(); }
    }, U.svgEl(ICONS.plus));

    /* 补记模式开关：仅过去日期显示 */
    const bfBtn = isPast ? U.h('button', {
      class: 'pill-btn bf-btn' + (backfill ? ' on' : ''),
      title: backfill ? '补记模式已开启，点击关闭' : '补记模式：为过去补录已完成的待办，时间可手动指定',
      onclick: toggleBackfill
    }, backfill ? '补记中' : '补记模式') : null;

    return U.h('div', { class: 'card add-card' + (locked ? ' locked' : '') }, addInput, bfBtn, btn);
  }

  function addPlaceholder() {
    if (!isPast) {
      return currentDate === U.today() ? '要做什么？回车添加' : '为 ' + U.fmtDay(currentDate) + ' 添加待办';
    }
    return backfill ? '补记：输入内容回车，时间稍后指定' : '过去的日期不能新增待办';
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
    /* 补记模式：为过去日期录入已完成待办，先选时间 */
    if (isPast && backfill) { openBackfillDialog(title); return; }
    if (isPast) return; /* 锁定态防御 */
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
    /* 默认模式下，过去的已完成任务锁定勾选框（不可取消完成） */
    const lockDone = isPast && t.done && !backfill;

    const check = U.h('button', {
      class: 'check',
      role: 'checkbox',
      'aria-checked': String(t.done),
      'aria-label': t.done ? '标记为未完成' : '标记为已完成',
      title: lockDone ? '过去的已完成任务默认不可修改，可开启「补记模式」' : null,
      disabled: lockDone || null,
      onclick: () => toggleItem(t.id)
    }, U.svgEl(ICONS.check));

    const title = U.h('span', {
      class: 'title',
      title: '双击编辑',
      ondblclick: () => startEdit(row, t)
    }, t.title);

    const row = U.h('li', {
      class: 'todo' + (t.done ? ' done' : ''),
      dataset: { id: t.id, flipId: t.id },
      style: '--cc:' + colorOf(t.id)
    }, U.h('i', { class: 'tick' }), check, title);

    row.append(buildActs(row, t));
    return row;
  }

  /* 行尾操作按钮：过去日期的未完成条目额外提供"移到今天" */
  function buildActs(row, t) {
    const editBtn = U.h('button', {
      class: 'mini-btn', 'aria-label': '编辑', title: '编辑',
      onclick: () => startEdit(row, t)
    }, U.svgEl(ICONS.pencil));

    const delBtn = U.h('button', {
      class: 'mini-btn danger', 'aria-label': '删除', title: '删除',
      onclick: () => removeItem(row, t)
    }, U.svgEl(ICONS.trash));

    const acts = U.h('span', { class: 'acts' });
    if (isPast && !t.done) {
      acts.append(U.h('button', {
        class: 'mini-btn move', 'aria-label': '移到今天', title: '移到今天（创建时间不变）',
        onclick: () => moveOne(t)
      }, U.svgEl(ICONS.moveToday)));
    }
    acts.append(editBtn, delBtn);
    return acts;
  }

  /* ---------- 顺延：把过去未完成的任务移到今天（createdAt 不变，可撤销） ---------- */
  function moveOne(t) {
    const originDate = currentDate;
    if (!S.moveTo(t.id, U.today())) return;
    refreshList(false);
    U.toast('已移到今天「' + t.title + '」', '撤销', () => {
      S.moveTo(t.id, originDate);
      if (ET.app && ET.app.refresh) ET.app.refresh();
    });
  }

  function movePendingToday() {
    const originDate = currentDate;
    const items = S.byDate(originDate).filter((t) => !t.done);
    if (!items.length) return;
    const today = U.today();
    for (const t of items) S.moveTo(t.id, today);
    refreshList(false);
    U.toast('已把 ' + items.length + ' 条未完成移到今天', '撤销', () => {
      for (const t of items) S.moveTo(t.id, originDate);
      if (ET.app && ET.app.refresh) ET.app.refresh();
    });
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
    /* 默认模式：过去的已完成任务不可取消勾选 */
    if (isPast && !backfill) {
      const cur = S.byDate(currentDate).find((x) => x.id === id);
      if (cur && cur.done) {
        U.toast('过去的已完成任务不可取消，可开启「补记模式」调整');
        return;
      }
    }
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

  /* ---------- 补记模式：为过去补录已完成待办（滚轮指定创建/完成时间） ---------- */
  let bfMask = null;

  function toggleBackfill() {
    backfill = !backfill;
    render(rootEl, { date: currentDate });
    if (isPast && backfill) U.toast('补记模式已开启：可为过去添加待办并指定时间');
  }

  const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  const WHEEL_H = 38; /* 滚轮单项高度，与 CSS 保持一致 */

  /* 滚轮列：scroll-snap 吸附，静止后回调中心值 */
  function buildWheel(vals, initVal, onChange) {
    const wheel = U.h('div', { class: 'wheel' });
    const frag = document.createDocumentFragment();
    frag.append(U.h('div', { class: 'wheel-pad' }));
    let cur = Math.max(0, vals.indexOf(initVal));
    vals.forEach((v, i) => {
      frag.append(U.h('div', { class: 'wheel-item' + (i === cur ? ' sel' : ''), dataset: { v: v } }, v));
    });
    frag.append(U.h('div', { class: 'wheel-pad' }));
    wheel.append(frag);

    let timer = 0;
    function settle() {
      const idx = wheelIdx(wheel, vals.length);
      wheel.querySelectorAll('.wheel-item').forEach((el, i) => el.classList.toggle('sel', i === idx));
      if (onChange) onChange(vals[idx]);
    }
    wheel.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(settle, 90);
    }, { passive: true });

    /* 初始定位：置于下一帧，保证容器已参与布局 */
    requestAnimationFrame(() => { wheel.scrollTop = cur * WHEEL_H; });
    return wheel;
  }

  function wheelIdx(wheel, len) {
    return Math.max(0, Math.min(len - 1, Math.round(wheel.scrollTop / WHEEL_H)));
  }
  const wheelVal = (wheel, vals) => vals[wheelIdx(wheel, vals.length)];

  function openBackfillDialog(rawTitle) {
    if (bfMask) return;
    const date = currentDate;

    const titleInput = U.h('input', {
      class: 'bf-title', value: rawTitle, maxlength: 120,
      'aria-label': '补记内容', placeholder: '补记内容'
    });

    const ch = buildWheel(HOURS, '09', validate);
    const cm = buildWheel(MINS, '00', validate);
    const ph = buildWheel(HOURS, '18', validate);
    const pm = buildWheel(MINS, '30', validate);
    const err = U.h('p', { class: 'bf-err', hidden: true }, '完成时间不能早于创建时间');

    const saveBtn = U.h('button', { class: 'pill-btn on bf-save', onclick: commit }, '保存');

    function validate() {
      const created = (+wheelVal(ch, HOURS)) * 60 + (+wheelVal(cm, MINS));
      const completed = (+wheelVal(ph, HOURS)) * 60 + (+wheelVal(pm, MINS));
      const bad = completed < created;
      err.hidden = !bad;
      saveBtn.disabled = bad;
    }

    function commit() {
      if (saveBtn.disabled) return;
      const title = titleInput.value.trim();
      if (!title) { titleInput.focus(); return; }
      S.add(date, title, {
        done: true,
        createdAt: U.isoAt(date, +wheelVal(ch, HOURS), +wheelVal(cm, MINS)),
        completedAt: U.isoAt(date, +wheelVal(ph, HOURS), +wheelVal(pm, MINS))
      });
      closeBackfillDialog();
      addInput.value = '';
      refreshList(false);
      U.toast('已补记「' + title + '」');
    }

    function closeBackfillDialog() {
      if (!bfMask) return;
      document.removeEventListener('keydown', onKey, true);
      bfMask.remove();
      bfMask = null;
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeBackfillDialog(); }
    };
    document.addEventListener('keydown', onKey, true);

    const card = U.h('div', { class: 'card bf-card', onclick: (e) => e.stopPropagation() },
      U.h('h3', { class: 'bf-head' }, '补记已完成待办'),
      U.h('p', { class: 'bf-sub' }, U.fmtDay(date) + ' · 时间可手动指定'),
      titleInput,
      U.h('div', { class: 'bf-row' }, U.h('span', { class: 'bf-label' }, '创建'), ch, cm),
      U.h('div', { class: 'bf-row' }, U.h('span', { class: 'bf-label' }, '完成'), ph, pm),
      err,
      U.h('div', { class: 'bf-foot' },
        U.h('button', { class: 'pill-btn', onclick: closeBackfillDialog }, '取消'),
        saveBtn));

    bfMask = U.h('div', { class: 'bf-mask' }, card);
    bfMask.addEventListener('click', (e) => { if (e.target === bfMask) closeBackfillDialog(); });
    document.body.append(bfMask);
    titleInput.focus();
    titleInput.select();
  }

  /* ---------- 供外部调用 ---------- */
  function focusAdd() {
    if (addInput) addInput.focus();
  }

  return { render: render, focusAdd: focusAdd };
})();
