/* ============================================================
   EasyTodo · stats.js
   数据统计页（全屏覆盖层，含返回按钮）：KPI 概览 + 六类图表，零依赖手写
     1. 近 30 天趋势 —— SVG 柱状 + 7 日移动平均平滑曲线
        （Catmull-Rom 转三次贝塞尔）+ 渐变面积 + 描边生长动画
     2. 活动热力 —— GitHub 风格 26 周 div 网格，5 档色阶
     3. 星期分布 —— SVG 雷达图（7 轴 4 环）
     4. 时段分布 —— 0–23 时 24 柱，峰值高亮
     5. 近 6 个月 —— div 柱状，按月完成量
     6. 积压年龄 —— 过去未完成任务的拖欠天数分段横条
   颜色全部走主题变量；tooltip 单例 + 事件委托；数据单次全量聚合；
   prefers-reduced-motion 时省略全部动画。
   ============================================================ */
window.ET = window.ET || {};

ET.statsPage = (function () {
  'use strict';
  const U = ET.utils;
  const S = ET.store;
  const NS = 'http://www.w3.org/2000/svg';

  let page, body, totalEl, tip;
  let savedY = 0, prevTitle = '';

  /* ---------- SVG 构建辅助 ---------- */
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const nilEl = (msg) => U.h('div', { class: 'sp-nil' }, msg);

  /* Catmull-Rom → 三次贝塞尔：把折线拟合成平滑曲线 */
  function smoothPath(p) {
    if (p.length < 2) return '';
    let d = 'M' + p[0][0].toFixed(1) + ' ' + p[0][1].toFixed(1);
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' +
        c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ' ' +
        p2[0].toFixed(1) + ' ' + p2[1].toFixed(1);
    }
    return d;
  }

  /* ---------- 生命周期 ---------- */
  function init() {
    page = document.getElementById('stats-page');
    if (!page) return;
    body = document.getElementById('sp-body');
    totalEl = document.getElementById('sp-total');
    tip = U.h('div', { class: 'sp-tip', 'aria-hidden': 'true' });
    page.append(tip);

    document.getElementById('btn-stats').addEventListener('click', open);
    document.getElementById('stats-back').addEventListener('click', close);

    /* tooltip：事件委托（整页一个监听器，悬停任何 [data-tip] 都生效） */
    page.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      tip.textContent = t.dataset.tip;
      tip.classList.add('show');
      moveTip(e);
    });
    page.addEventListener('mousemove', (e) => {
      if (tip.classList.contains('show')) moveTip(e);
    });
    page.addEventListener('mouseout', (e) => {
      const t = e.target.closest('[data-tip]');
      if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) tip.classList.remove('show');
    });
    page.addEventListener('scroll', () => tip.classList.remove('show'), true);
  }

  function isOpen() { return !!page && !page.hidden; }

  function open() {
    if (isOpen()) return;
    savedY = scrollY;
    prevTitle = document.title;
    document.getElementById('app').hidden = true;
    page.hidden = false;
    scrollTo(0, 0);
    document.title = '数据统计 · EasyTodo';
    render();
    document.getElementById('stats-back').focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen()) return;
    page.hidden = true;
    document.getElementById('app').hidden = false;
    document.title = prevTitle;
    scrollTo(0, savedY);
    document.getElementById('btn-stats').focus({ preventScroll: true });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    const todos = S.all();
    const today = U.today();
    body.classList.toggle('sp-anim', U.motionOK());

    if (!todos.length) {
      totalEl.textContent = '';
      body.replaceChildren(U.h('div', { class: 'sp-empty' },
        U.svgEl('<svg viewBox="0 0 24 24"><path d="M5 20v-9"/><path d="M12 20V4"/><path d="M19 20v-6"/></svg>'),
        U.h('div', { class: 't1' }, '还没有任何数据'),
        U.h('div', { class: 'sp-sub' }, '回到清单添加几条待办，这里就会长出图表')));
      return;
    }

    /* —— 单次全量聚合 —— */
    let done = 0;
    const byDone = new Map();            /* 完成日期 -> 件数 */
    const hours = new Array(24).fill(0); /* 完成时刻 0-23 */
    const weeks = new Array(7).fill(0);  /* 完成星期（周一起） */
    const byMonth = new Map();           /* 'YYYY-MM' -> 件数 */
    for (const t of todos) {
      if (!t.done) continue;
      done++;
      const iso = t.completedAt || t.createdAt || '';
      const cd = iso.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) continue;
      byDone.set(cd, (byDone.get(cd) || 0) + 1);
      weeks[(U.parseDate(cd).getDay() + 6) % 7]++;
      const ym = cd.slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) || 0) + 1);
      const hh = +iso.slice(11, 13);
      if (hh >= 0 && hh <= 23) hours[hh]++;
    }
    const pending = S.pendingBefore(today);
    const ts = S.stats();

    totalEl.textContent = '共 ' + todos.length + ' 条 · 已完成 ' + done + ' · 未完成 ' + (todos.length - done);

    const kpis = [
      { label: '累计完成', val: String(done), kc: 'var(--c2)' },
      { label: '完成率', val: Math.round(done / todos.length * 100) + '%', kc: 'var(--c3)' },
      { label: '连续完成', val: String(ts.streak), unit: '天', kc: 'var(--c5)' },
      { label: '近 7 天', val: String(ts.weekDone), kc: 'var(--c4)' },
      { label: '今日完成', val: String(ts.todayDone), kc: 'var(--accent)' },
      { label: '待清偿', val: String(pending.length), unit: '项', kc: 'var(--danger)',
        vc: pending.length ? 'color:var(--danger)' : null }
    ];

    body.replaceChildren(
      U.h('div', { class: 'sp-kpis' }, kpis.map((k) =>
        U.h('div', { class: 'sp-kpi', style: '--kc:' + k.kc },
          U.h('span', { class: 'k' }, U.h('i'), k.label),
          U.h('b', k.vc ? { style: k.vc } : null, k.val,
            k.unit ? U.h('small', null, ' ' + k.unit) : null)))),
      U.h('div', { class: 'sp-grid' },
        card('近 30 天完成趋势', '每日完成数（柱）与 7 日移动平均（线）', trendChart(byDone, today), true),
        card('活动热力', '近 26 周每日完成密度', heatChart(byDone, today), true),
        card('星期分布', '按完成日期累计（周一 → 周日）', radarChart(weeks)),
        card('时段分布', '任务在一天中哪个时段被完成', hoursChart(hours)),
        card('近 6 个月', '按月完成量', monthChart(byMonth, today)),
        card('积压年龄', '过去未完成任务的拖欠天数', backlogChart(pending, today)))
    );
  }

  function card(title, sub, el, wide) {
    return U.h('section', { class: 'sp-card' + (wide ? ' wide' : '') },
      U.h('h3', null, title),
      U.h('div', { class: 'sp-sub' }, sub),
      U.h('div', { class: 'sp-chart' }, el));
  }

  /* ---------- 1. 近 30 天趋势 ---------- */
  function trendChart(byDone, today) {
    const N = 30;
    const days = [], vals = [];
    for (let i = N - 1; i >= 0; i--) {
      const ds = U.addDays(today, -i);
      days.push(ds);
      vals.push(byDone.get(ds) || 0);
    }
    const maxV = Math.max(...vals);
    if (!maxV) return nilEl('近 30 天还没有完成记录');

    const W = 860, H = 248, L = 40, R = 12, T = 16, B = 28;
    const pw = W - L - R, ph = H - T - B;
    const yMax = Math.max(4, Math.ceil(maxV / 4) * 4);
    const x = (i) => L + (i + .5) * pw / N;
    const y = (v) => T + ph - (v / yMax) * ph;
    const bw = Math.min(15, (pw / N) * .56);

    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '近 30 天完成趋势图' });

    /* 面积渐变 */
    svg.append(sv('defs', null,
      sv('linearGradient', { id: 'sp-grad', x1: 0, y1: 0, x2: 0, y2: 1 },
        sv('stop', { offset: '0', style: 'stop-color:var(--accent);stop-opacity:.2' }),
        sv('stop', { offset: '1', style: 'stop-color:var(--accent);stop-opacity:0' }))));

    /* 横向网格 + y 轴刻度 */
    for (const gv of [0, yMax / 2, yMax]) {
      svg.append(sv('line', { class: 'gline', x1: L, x2: W - R, y1: y(gv).toFixed(1), y2: y(gv).toFixed(1) }));
      svg.append(sv('text', { x: L - 8, y: (y(gv) + 3.5).toFixed(1), 'text-anchor': 'end' }, String(gv)));
    }

    /* 7 日移动平均（前 6 天用不完整窗口） */
    const pts = vals.map((_, i) => {
      const s = Math.max(0, i - 6);
      let sum = 0;
      for (let j = s; j <= i; j++) sum += vals[j];
      return [x(i), y(sum / (i - s + 1))];
    });
    const lineD = smoothPath(pts);
    svg.append(sv('path', {
      class: 'sp-area',
      d: lineD + 'L' + x(N - 1).toFixed(1) + ' ' + y(0).toFixed(1) +
        'L' + x(0).toFixed(1) + ' ' + y(0).toFixed(1) + 'Z',
      fill: 'url(#sp-grad)'
    }));

    vals.forEach((v, i) => {
      if (!v) return;
      svg.append(sv('rect', {
        class: 'sp-bar',
        x: (x(i) - bw / 2).toFixed(1), y: y(v).toFixed(1),
        width: bw.toFixed(1), height: (y(0) - y(v)).toFixed(1), rx: 3,
        'data-tip': U.fmtDay(days[i]) + ' ' + U.weekShort(days[i]) + ' · 完成 ' + v + ' 项',
        style: '--d:' + Math.round(i * 14) + 'ms'
      }));
    });

    const line = sv('path', { class: 'sp-line', d: lineD, fill: 'none' });
    svg.append(line);

    for (let i = 0; i < N; i += 5) {
      svg.append(sv('text', { x: x(i).toFixed(1), y: H - 8, 'text-anchor': 'middle' },
        +days[i].slice(5, 7) + '/' + +days[i].slice(8, 10)));
    }

    /* 曲线描边生长动画 */
    if (U.motionOK()) {
      requestAnimationFrame(() => {
        try {
          const len = line.getTotalLength();
          line.style.strokeDasharray = len;
          line.style.strokeDashoffset = len;
          line.getBoundingClientRect(); /* 强制布局，确保过渡生效 */
          line.style.transition = 'stroke-dashoffset .9s cubic-bezier(.33,1,.68,1) .3s';
          line.style.strokeDashoffset = '0';
        } catch (e) { /* 渲染时机异常时直接显示静态曲线 */ }
      });
    }
    return svg;
  }

  /* ---------- 2. 活动热力（26 周 × 7 天） ---------- */
  function heatChart(byDone, today) {
    const WEEKS = 26, CELL = 13, GAP = 3;
    const start = U.addDays(U.weekStart(today), -(WEEKS - 1) * 7);

    const grid = U.h('div', { class: 'hm-grid' });
    const monthSpans = [];
    let prevMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      for (let r = 0; r < 7; r++) {
        const ds = U.addDays(start, w * 7 + r);
        if (ds > today) continue; /* 未来不渲染，网格止于今天 */
        const v = byDone.get(ds) || 0;
        const lvl = v === 0 ? 0 : v === 1 ? 1 : v <= 3 ? 2 : v <= 6 ? 3 : 4;
        grid.append(U.h('i', {
          class: 'hm-c hm-l' + lvl + (ds === today ? ' today' : ''),
          'data-tip': U.fmtDay(ds) + ' ' + U.weekShort(ds) + ' · ' + (v ? '完成 ' + v + ' 项' : '无完成'),
          style: '--d:' + Math.round(w * 10) + 'ms'
        }));
      }
      /* 行首（周一）换月时打月标签 */
      const wFirst = U.addDays(start, w * 7);
      const m = +wFirst.slice(5, 7) - 1;
      if (m !== prevMonth) {
        monthSpans.push(U.h('span', { style: 'left:' + (w * (CELL + GAP)) + 'px' }, (m + 1) + '月'));
        prevMonth = m;
      }
    }

    const days = U.h('div', { class: 'hm-days' },
      U.h('span', null, '一'), U.h('span'),
      U.h('span', null, '三'), U.h('span'),
      U.h('span', null, '五'), U.h('span'), U.h('span'));

    return U.h('div', null,
      U.h('div', { class: 'hm' },
        days,
        U.h('div', { class: 'hm-scroll' },
          U.h('div', { class: 'hm-inner' },
            U.h('div', { class: 'hm-months' }, monthSpans), grid))),
      U.h('div', { class: 'hm-legend' }, '少',
        [0, 1, 2, 3, 4].map((l) => U.h('i', { class: 'hm-c hm-l' + l })), '多'));
  }

  /* ---------- 3. 星期分布雷达图 ---------- */
  function radarChart(weeks) {
    const maxV = Math.max(...weeks);
    if (!maxV) return nilEl('还没有完成记录');
    const SZ = 252, C = SZ / 2, R = 84, N = 7;
    const LAB = ['一', '二', '三', '四', '五', '六', '日'];
    const ang = (i) => (-90 + i * 360 / N) * Math.PI / 180;
    const pt = (i, r) => [C + Math.cos(ang(i)) * r, C + Math.sin(ang(i)) * r];
    const fmt = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);

    const svg = sv('svg', { viewBox: '0 0 ' + SZ + ' ' + SZ, class: 'sp-radar', role: 'img', 'aria-label': '星期分布雷达图' });

    for (const f of [0.25, 0.5, 0.75, 1]) {
      svg.append(sv('polygon', { class: 'rline',
        points: Array.from({ length: N }, (_, i) => fmt(pt(i, R * f))).join(' ') }));
    }
    for (let i = 0; i < N; i++) {
      const o = pt(i, R);
      svg.append(sv('line', { class: 'spoke', x1: C, y1: C, x2: o[0].toFixed(1), y2: o[1].toFixed(1) }));
    }

    const pts = weeks.map((v, i) => pt(i, (v / maxV) * R));
    svg.append(sv('polygon', { class: 'poly', points: pts.map(fmt).join(' ') }));

    weeks.forEach((v, i) => {
      const lp = pt(i, R + 17);
      svg.append(sv('text', { class: 'lab', x: lp[0].toFixed(1), y: (lp[1] + 3.5).toFixed(1), 'text-anchor': 'middle' }, '周' + LAB[i]));
      svg.append(sv('circle', { class: 'dot', cx: pts[i][0].toFixed(1), cy: pts[i][1].toFixed(1), r: 4,
        'data-tip': '周' + LAB[i] + ' · 累计完成 ' + v + ' 项' }));
    });
    return svg;
  }

  /* ---------- 4. 时段分布（0–23 时） ---------- */
  function hoursChart(hours) {
    const maxV = Math.max(...hours);
    if (!maxV) return nilEl('还没有完成记录');
    const N = 24, W = 460, H = 196, L = 26, R = 6, T = 12, B = 24;
    const pw = W - L - R, ph = H - T - B;
    const yMax = Math.max(2, Math.ceil(maxV / 2) * 2);
    const x = (i) => L + (i + .5) * pw / N;
    const y = (v) => T + ph - (v / yMax) * ph;
    const bw = Math.min(13, (pw / N) * .6);
    const hot = hours.indexOf(maxV);

    const svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': '时段分布图' });
    for (const gv of [0, yMax / 2, yMax]) {
      svg.append(sv('line', { class: 'gline', x1: L, x2: W - R, y1: y(gv).toFixed(1), y2: y(gv).toFixed(1) }));
      svg.append(sv('text', { x: L - 8, y: (y(gv) + 3.5).toFixed(1), 'text-anchor': 'end' }, String(gv)));
    }
    hours.forEach((v, i) => {
      if (!v) return;
      svg.append(sv('rect', {
        class: 'sp-hbar' + (i === hot ? ' hot' : ''),
        x: (x(i) - bw / 2).toFixed(1), y: y(v).toFixed(1),
        width: bw.toFixed(1), height: (y(0) - y(v)).toFixed(1), rx: 2.5,
        'data-tip': U.pad(i) + ':00–' + U.pad(i) + ':59 · 完成 ' + v + ' 项',
        style: '--d:' + Math.round(i * 12) + 'ms'
      }));
    });
    for (let i = 0; i < N; i += 3) {
      svg.append(sv('text', { x: x(i).toFixed(1), y: H - 7, 'text-anchor': 'middle' }, i + '时'));
    }
    return svg;
  }

  /* ---------- 5. 近 6 个月柱状 ---------- */
  function monthChart(byMonth, today) {
    const cols = [];
    for (let i = 5; i >= 0; i--) {
      const ym = U.addMonths(today, -i).slice(0, 7);
      cols.push({ ym: ym, v: byMonth.get(ym) || 0 });
    }
    const maxV = Math.max(...cols.map((c) => c.v));
    if (!maxV) return nilEl('近 6 个月还没有完成记录');
    const hot = cols.reduce((m, c, i) => (c.v > cols[m].v ? i : m), 0);
    return U.h('div', { class: 'sp-mchart' },
      cols.map((c, i) => U.h('div', { class: 'sp-mcol' + (i === hot && c.v ? ' hot' : '') },
        U.h('span', { class: 'sp-mval' }, String(c.v)),
        U.h('div', { class: 'sp-mtrack' },
          U.h('div', {
            class: 'sp-mbar',
            style: 'height:' + Math.max((c.v / maxV) * 100, c.v ? 5 : 2.5) + '%;--d:' + Math.round(i * 70) + 'ms',
            'data-tip': +c.ym.slice(0, 4) + '年' + +c.ym.slice(5, 7) + '月 · 完成 ' + c.v + ' 项'
          })),
        U.h('span', { class: 'sp-mlab' }, +c.ym.slice(5, 7) + '月'))));
  }

  /* ---------- 6. 积压年龄分布 ---------- */
  function backlogChart(pending, today) {
    if (!pending.length) return nilEl('没有积压，把每一天都过得干干净净');
    const defs = [
      { lab: '1–3 天', max: 3, c: 'var(--c2)' },
      { lab: '4–7 天', max: 7, c: 'var(--c5)' },
      { lab: '8–14 天', max: 14, c: 'var(--c3)' },
      { lab: '15–30 天', max: 30, c: 'var(--c1)' },
      { lab: '30 天以上', max: Infinity, c: 'var(--danger)' }
    ];
    const counts = new Array(defs.length).fill(0);
    for (const t of pending) {
      const od = Math.round((U.parseDate(today) - U.parseDate(t.date)) / 86400000);
      const idx = defs.findIndex((d) => od <= d.max);
      counts[idx === -1 ? defs.length - 1 : idx]++;
    }
    const maxV = Math.max(...counts);
    return U.h('div', { class: 'bl' }, defs.map((d, i) => U.h('div', { class: 'bl-row' },
      U.h('span', { class: 'bl-lab' }, d.lab),
      U.h('div', { class: 'bl-track' },
        U.h('i', {
          class: 'bl-fill',
          style: 'width:' + (counts[i] / maxV * 100) + '%;--bc:' + d.c + ';--d:' + Math.round(i * 70) + 'ms',
          'data-tip': d.lab + ' · ' + counts[i] + ' 项'
        })),
      U.h('b', { class: 'bl-num' }, String(counts[i])))));
  }

  /* ---------- tooltip 定位（水平居中于光标，越界夹紧） ---------- */
  function moveTip(e) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX - w / 2;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    let ty = e.clientY - h - 14;
    if (ty < 8) ty = e.clientY + 18;
    tip.style.left = x + 'px';
    tip.style.top = ty + 'px';
  }

  return { init: init, open: open, close: close, isOpen: isOpen };
})();
