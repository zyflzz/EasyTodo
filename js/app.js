/* ============================================================
   EasyTodo · app.js
   应用入口：路由与工具栏 · 主题弹层 · 全局搜索 · 快捷键
   ============================================================ */
(function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;

  const VIEWS = ['day', 'week', 'month', 'year'];
  const TODAY_LABEL = { day: '今天', week: '本周', month: '本月', year: '今年' };

  const $ = (s) => document.querySelector(s);
  const content = $('#content');
  const periodTitle = $('#period-title');
  const todayBadge = $('#today-badge');
  const btnToday = $('#btn-today');
  const tabButtons = Array.from(document.querySelectorAll('#tabs .tab'));

  const state = {
    view: validView(S.prefsGet('view', 'day')),
    date: U.today()
  };

  function validView(v) { return VIEWS.includes(v) ? v : 'day'; }

  /* ---------- 锚点归一：切换视图时对齐周期起点 ---------- */
  function normalize(view, date) {
    if (view === 'week') return U.weekStart(date);
    if (view === 'month') return date.slice(0, 7) + '-01';
    if (view === 'year') return date.slice(0, 4) + '-01-01';
    return date;
  }

  function period(view, date) {
    if (view === 'day') return U.fmtDay(date) + ' ' + U.weekday(date);
    if (view === 'week') {
      const a = U.weekStart(date), b = U.addDays(a, 6);
      return a.slice(5, 7) === b.slice(5, 7)
        ? U.fmtDay(a) + ' – ' + b.slice(8) + '日'
        : U.fmtDay(a) + ' – ' + U.fmtDay(b);
    }
    if (view === 'month') return date.slice(0, 4) + '年' + Number(date.slice(5, 7)) + '月';
    return date.slice(0, 4) + '年';
  }

  const atCurrentPeriod = () => period(state.view, state.date) === period(state.view, U.today());

  /* ---------- 渲染 ---------- */
  function render() {
    state.date = normalize(state.view, state.date);
    document.body.dataset.view = state.view;

    tabButtons.forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
    periodTitle.textContent = period(state.view, state.date);
    todayBadge.hidden = !(state.view === 'day' && state.date === U.today());
    btnToday.textContent = TODAY_LABEL[state.view];
    btnToday.classList.toggle('on', atCurrentPeriod());

    content.className = 'view view-' + state.view;
    ET.views[state.view].render(content, state);

    if (U.motionOK()) {
      content.animate(
        [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
        { duration: 230, easing: 'cubic-bezier(.22,1,.36,1)' }
      );
    }
  }

  function step(dir) {
    const d = state.date;
    state.date =
      state.view === 'day' ? U.addDays(d, dir) :
      state.view === 'week' ? U.addDays(d, 7 * dir) :
      state.view === 'month' ? U.addMonths(d, dir) : U.addYears(d, dir);
    render();
  }

  /* 供视图模块调用的导航 API */
  ET.nav = {
    to(view, date, focusAdd) {
      closeSearch(); closePop();
      state.view = validView(view);
      state.date = normalize(state.view, date || state.date);
      S.prefsSet('view', state.view);
      render();
      if (focusAdd && state.view === 'day') {
        queueMicrotask(() => ET.views.day.focusAdd && ET.views.day.focusAdd());
      }
    },
    today() { this.to(state.view, U.today()); },
    refresh() { render(); }
  };

  /* ---------- 工具栏事件 ---------- */
  $('#btn-prev').addEventListener('click', () => step(-1));
  $('#btn-next').addEventListener('click', () => step(1));
  btnToday.addEventListener('click', () => ET.nav.today());
  tabButtons.forEach((b) => b.addEventListener('click', () => ET.nav.to(b.dataset.view)));

  /* ---------- 主题弹层 ---------- */
  const themeWrap = $('#theme-wrap');
  let pop = null;

  function openPop() {
    const cur = ET.theme.current();
    pop = U.h('div', { class: 'theme-pop', role: 'menu', 'aria-label': '选择主题' },
      ET.theme.THEMES.map((t) => {
        const on = t.id === cur;
        return U.h('button', {
          class: 'swatch' + (on ? ' on' : ''),
          role: 'menuitemradio',
          'aria-checked': String(on),
          onclick: (e) => { e.stopPropagation(); ET.theme.select(t.id); closePop(); }
        },
          U.h('span', { class: 'dots' },
            U.h('i', { style: 'background:' + t.dot[0] }),
            U.h('i', { style: 'background:' + t.dot[1] })),
          t.name);
      }));
    themeWrap.append(pop);
    setTimeout(() => document.addEventListener('click', closePopOnce), 0);
  }
  function closePopOnce() { closePop(); }
  function closePop() {
    if (pop) { pop.remove(); pop = null; }
    document.removeEventListener('click', closePopOnce);
  }
  $('#btn-theme').addEventListener('click', (e) => {
    e.stopPropagation();
    pop ? closePop() : openPop();
  });

  /* ---------- 数据面板（文件存储 / 导出导入） ---------- */
  const dataWrap = $('#data-wrap');
  let dataPop = null;
  let fileInput = null;

  const STATE_META = {
    ready: { dot: 'ok', label: (n) => '已绑定「' + n + '」' },
    prompt: { dot: 'warn', label: (n) => '「' + n + '」待重新授权' },
    unbound: { dot: '', label: () => '未绑定文件夹' },
    unsupported: { dot: '', label: () => '当前浏览器不支持' }
  };

  function openDataPop() {
    const st = ET.fileStore.status;
    const meta = STATE_META[st.state] || STATE_META.unbound;
    const supported = ET.fileStore.supported();

    const mainBtn = !supported ? null :
      st.state === 'ready'
        ? U.h('button', { class: 'dp-main ghost', onclick: () => doConnect(true) }, '重新选择文件夹')
        : U.h('button', {
            class: 'dp-main', title: '建议在浏览器授权弹窗中选择「每次访问时允许」，可减少重复授权',
            onclick: () => doConnect(false)
          },
          st.state === 'prompt' ? '恢复授权' : '绑定数据文件夹');

    const statusText = supported
      ? meta.label(st.name)
      : '数据保存在浏览器本地（需 Edge/Chrome 支持文件存储）';

    dataPop = U.h('div', { class: 'data-pop', role: 'menu', 'aria-label': '数据存储' },
      U.h('div', { class: 'dp-status' },
        U.h('span', { class: 'dp-dot ' + meta.dot }),
        U.h('span', null, statusText)),
      mainBtn,
      U.h('div', { class: 'dp-actions' },
        U.h('button', {
          class: 'dp-btn',
          disabled: !(st.state === 'ready' || st.state === 'prompt'),
          title: '在资源管理器中查看数据所在目录',
          onclick: () => { ET.fileStore.openFolder(); closeDataPop(); }
        }, '打开文件夹'),
        U.h('button', { class: 'dp-btn', onclick: () => { ET.fileStore.exportJSON(); closeDataPop(); } }, '导出备份'),
        U.h('button', { class: 'dp-btn', onclick: () => fileInput && fileInput.click() }, '导入数据')),
      st.state === 'ready'
        ? U.h('button', { class: 'dp-link', onclick: async () => { await ET.fileStore.unbind(); openDataPop(); } }, '解除文件夹绑定')
        : null,
      U.h('p', { class: 'dp-note' },
        supported
          ? '数据实时保存在浏览器本地；绑定文件夹后自动同步为 data/easytodo-data.json。建议绑定本项目文件夹；打开页面后任意点击一次即可自动恢复授权。'
          : '改用 Edge / Chrome 打开即可绑定文件夹，生成可查看的 data/easytodo-data.json。'));

    dataWrap.append(dataPop);
    setTimeout(() => document.addEventListener('click', closeDataPopOnce), 0);
  }

  async function doConnect(rebind) {
    const r = await ET.fileStore.connect(rebind);
    if (r.state === 'ready') {
      if (r.migrated) {
        U.toast('数据已迁移至 data 文件夹');
        if (r.loaded > 0) ET.app.refresh();
      } else if (r.loaded > 0) {
        U.toast('已从 data/easytodo-data.json 恢复 ' + r.loaded + ' 条待办');
        ET.app.refresh();
      } else {
        U.toast('已绑定「' + r.name + '」，数据将保存为 data/easytodo-data.json');
      }
      closeDataPop();
    } else if (r.state !== 'unbound') {
      openDataPop(); /* 刷新面板状态 */
    }
  }

  function closeDataPopOnce() { closeDataPop(); }
  function closeDataPop() {
    if (dataPop) { dataPop.remove(); dataPop = null; }
    document.removeEventListener('click', closeDataPopOnce);
  }
  $('#btn-data').addEventListener('click', (e) => {
    e.stopPropagation();
    dataPop ? closeDataPop() : openDataPop();
  });

  /* 导入文件选择器（常驻隐藏） */
  fileInput = U.h('input', {
    type: 'file', accept: '.json,application/json', style: 'display:none',
    'aria-hidden': 'true'
  });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    try {
      const n = await ET.fileStore.importJSON(f);
      U.toast('已导入 ' + n + ' 条待办');
      ET.app.refresh();
      closeDataPop();
    } catch (e) {
      U.toast('导入失败：' + (e && e.message ? e.message : '文件无法解析'));
    }
  });
  document.body.append(fileInput);

  /* ---------- 全局搜索 ---------- */
  const overlay = U.h('div', { class: 'overlay', id: 'search-overlay' });
  const searchInput = U.h('input', {
    type: 'text',
    placeholder: '搜索全部待办…',
    'aria-label': '搜索待办'
  });
  const searchResults = U.h('div', { class: 'results' });
  const panel = U.h('div', { class: 'search-panel', role: 'dialog', 'aria-label': '搜索' },
    U.h('div', { class: 'search-row' },
      U.svgEl('<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></svg>'),
      searchInput,
      U.h('kbd', null, 'Esc')),
    searchResults);
  overlay.append(panel);
  document.body.append(overlay);

  searchInput.addEventListener('input', () => renderResults(searchInput.value.trim()));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSearch(); });

  const colorOf = (id) => 'var(--c' + (U.hash(id) % 6 + 1) + ')';

  function renderResults(q) {
    if (!q) {
      searchResults.replaceChildren(
        U.h('div', { class: 'search-hint' }, '输入关键词，跨日期搜索所有待办'));
      return;
    }
    const hits = S.search(q).slice(0, 50);
    if (!hits.length) {
      searchResults.replaceChildren(
        U.h('div', { class: 'search-empty' }, '没有找到与「' + q + '」相关的待办'));
      return;
    }
    const t = U.today();
    searchResults.replaceChildren(...hits.map((it) => {
      const isToday = it.date === t;
      return U.h('div', {
        class: 'result' + (it.done ? ' done' : ''),
        style: '--cc:' + colorOf(it.id),
        onclick: () => ET.nav.to('day', it.date)
      },
        U.h('span', { class: 'rdate' + (isToday ? ' today' : '') },
          (isToday ? '今天 · ' : '') + U.fmtDay(it.date) + ' ' + U.weekShort(it.date)),
        U.h('i', { class: 'rdot' }),
        U.h('span', { class: 'rtitle' }, it.title));
    }));
  }

  function openSearch() {
    overlay.classList.add('open');
    searchInput.value = '';
    renderResults('');
    requestAnimationFrame(() => searchInput.focus());
  }
  function closeSearch() { overlay.classList.remove('open'); }
  $('#btn-search').addEventListener('click', openSearch);

  /* ---------- 键盘快捷键 ---------- */
  document.addEventListener('keydown', (e) => {
    const tgt = e.target;
    const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);

    if (e.key === 'Escape') {
      if (overlay.classList.contains('open')) closeSearch();
      closePop();
      closeDataPop();
      return;
    }
    /* 搜索浮层打开时：仅响应关闭与输入 */
    if (overlay.classList.contains('open')) {
      if (e.key === 'Enter') {
        const first = searchResults.querySelector('.result');
        if (first && searchInput.value.trim()) first.click();
      }
      return;
    }

    /* Ctrl/Cmd + K 或 / 打开搜索 */
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (!typing && e.key === '/') {
      e.preventDefault();
      openSearch();
      return;
    }

    if (typing || e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 't' || e.key === 'T') ET.nav.today();
    else if (e.key === 'n' || e.key === 'N') ET.nav.to('day', state.date, true);
    else if (e.key >= '1' && e.key <= '4') ET.nav.to(VIEWS[Number(e.key) - 1]);
  });

  /* ---------- 启动 ---------- */
  ET.theme.init();
  render();
  /* 暴露给撤销等场景 */
  ET.app = { refresh: () => render() };
  /* 异步连接本地数据文件（不阻塞首屏；上次已授权则自动恢复数据） */
  if (ET.fileStore.supported()) {
    ET.fileStore.init().then((r) => {
      if (r && r.migrated) {
        ET.app.refresh();
        U.toast('数据已迁移至 data 文件夹');
      } else if (r && r.loaded > 0) {
        ET.app.refresh();
        U.toast('已从 data/easytodo-data.json 恢复 ' + r.loaded + ' 条待办');
      }
      /* file:// 页面的授权无法跨会话持久：待授权时在首次点击中自动恢复，
         免去每次手动到面板点"恢复授权" */
      if (r && r.state === 'prompt') {
        document.addEventListener('click', () => {
          ET.fileStore.connect().then((res) => {
            if (res.state === 'ready') {
              if (res.migrated) ET.app.refresh();
              if (res.loaded > 0) {
                ET.app.refresh();
                U.toast('数据文件夹已连接，恢复 ' + res.loaded + ' 条待办');
              } else {
                U.toast('数据文件夹已连接');
              }
            }
            /* 用户在浏览器弹窗中拒绝时静默，可随时在数据面板手动恢复 */
          });
        }, { once: true });
      }
    });
  }
})();
