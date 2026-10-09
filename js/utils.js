/* ============================================================
   EasyTodo · utils.js
   工具集：日期计算 · DOM 构建 · FLIP 动画 · Toast
   ============================================================ */
window.ET = window.ET || {};

ET.utils = (function () {
  'use strict';

  /* ---------- 日期 ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const toDateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseDate = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const today = () => toDateStr(new Date());
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  const addDays = (s, n) => {
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  };
  const addMonths = (s, n) => {
    const d = parseDate(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
    return toDateStr(d);
  };
  const addYears = (s, n) => addMonths(s, n * 12);
  /* 周一为一周起点 */
  const weekStart = (s) => {
    const d = parseDate(s);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);
    return toDateStr(d);
  };

  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const WEEK_SHORT = ['一', '二', '三', '四', '五', '六', '日']; // 周一起始

  const fmtDay = (s) => {
    const d = parseDate(s);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };
  const weekday = (s) => WEEKDAYS[parseDate(s).getDay()];
  const weekShort = (s) => '周' + WEEK_SHORT[(parseDate(s).getDay() + 6) % 7];

  /* ISO 8601 本地时区格式：2024-05-30T14:30:00+08:00 */
  const isoLocal = (d) => {
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  };

  /* ---------- 通用 ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const hash = (str) => {
    let x = 0;
    for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) >>> 0;
    return x;
  };

  const debounce = (fn, ms) => {
    let t = 0;
    const f = function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); };
    return f;
  };

  const motionOK = () => matchMedia('(prefers-reduced-motion: no-preference)').matches;

  /* ---------- DOM 构建 ----------
     h(tag, attrs, ...children)：children 中的字符串安全地以文本节点插入 */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style') el.style.cssText = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  /* 从受信任的静态字符串创建 SVG 元素 */
  function svgEl(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstElementChild;
  }

  /* ---------- FLIP 列表重排动画 ----------
     rerender 前记录每个 [data-flip-id] 的位置，重渲染后从旧位置平滑滑到新位置 */
  function flip(container, rerender) {
    const prev = new Map();
    container.querySelectorAll('[data-flip-id]').forEach((el) => {
      prev.set(el.dataset.flipId, el.getBoundingClientRect().top);
    });
    rerender();
    if (!motionOK()) return;
    requestAnimationFrame(() => {
      container.querySelectorAll('[data-flip-id]').forEach((el) => {
        const old = prev.get(el.dataset.flipId);
        if (old == null) return;
        const dy = old - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 2) return;
        el.style.transition = 'none';
        el.style.transform = 'translateY(' + dy + 'px)';
        requestAnimationFrame(() => {
          el.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)';
          el.style.transform = '';
          el.addEventListener('transitionend', function te(e) {
            if (e.propertyName !== 'transform') return;
            el.style.transition = '';
            el.removeEventListener('transitionend', te);
          });
        });
      });
    });
  }

  /* ---------- Toast ---------- */
  let toastTimer = 0;
  function toast(msg, actionLabel, onAction) {
    const root = document.getElementById('toast');
    if (!root) return;
    root.querySelector('#toast-msg').textContent = msg;
    const act = root.querySelector('#toast-act');
    if (actionLabel) {
      act.hidden = false;
      act.textContent = actionLabel;
      act.onclick = () => { hide(); if (onAction) onAction(); };
    } else {
      act.hidden = true;
      act.onclick = null;
    }
    root.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, actionLabel ? 5000 : 2600);
    function hide() { root.classList.remove('show'); }
  }

  /* ---------- 喝彩动画（勾选完成时撒彩纸，纯视觉无声音） ---------- */
  const CHEER_EMOJIS = ['🎉', '✨', '👏', '🎊'];
  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  function celebrate(x, y, big) {
    if (!motionOK()) return;
    /* 彩纸颜色跟随当前主题的莫兰迪色板 */
    const cs = getComputedStyle(document.documentElement);
    const colors = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6']
      .map((v) => cs.getPropertyValue(v).trim() || '#C4A6A2');

    const n = big ? 36 : 16;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'confetti';
      const size = 5 + Math.random() * 6;
      p.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' +
        (Math.random() > .5 ? size : size * .45) + 'px;background:' + colors[i % colors.length] + ';';
      document.body.appendChild(p);
      const angle = Math.random() * Math.PI * 2;
      const dist = (big ? 70 : 40) + Math.random() * (big ? 110 : 70);
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist - (big ? 70 : 40); /* 整体偏向上抛 */
      p.animate([
        { transform: 'translate(0,0) rotate(0)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) rotate(' + rand(-360, 360) + 'deg)', opacity: 1, offset: .55 },
        { transform: 'translate(' + dx * 1.15 + 'px,' + (dy + 70) + 'px) rotate(' + rand(-540, 540) + 'deg) scale(.6)', opacity: 0 }
      ], { duration: 800 + Math.random() * 500, easing: 'cubic-bezier(.15,.6,.4,1)' })
        .onfinish = () => p.remove();
    }

    /* 飘出表情 */
    const e = document.createElement('div');
    e.className = 'cheer';
    e.textContent = CHEER_EMOJIS[rand(0, CHEER_EMOJIS.length - 1)];
    e.style.left = x + 'px';
    e.style.top = y + 'px';
    document.body.appendChild(e);
    e.animate([
      { transform: 'translate(-50%,0) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%,-40px) scale(1.25)', opacity: 1, offset: .4 },
      { transform: 'translate(-50%,-72px) scale(1)', opacity: 0 }
    ], { duration: 950, easing: 'ease-out' }).onfinish = () => e.remove();
  }

  return {
    pad, toDateStr, parseDate, today, daysInMonth,
    addDays, addMonths, addYears, weekStart,
    fmtDay, weekday, weekShort, WEEK_SHORT,
    uid, hash, debounce, motionOK, isoLocal,
    h, svgEl, flip, toast, celebrate
  };
})();
