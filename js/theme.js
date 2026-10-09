/* ============================================================
   EasyTodo · theme.js
   主题管理：6 套莫兰迪主题（4 明 2 暗）· 首选跟随系统
   ============================================================ */
window.ET = window.ET || {};

ET.theme = (function () {
  'use strict';

  const THEMES = [
    { id: 'linen', name: '亚麻米', dot: ['#8A7A6D', '#C4A6A2'] },
    { id: 'rose',  name: '豆沙粉', dot: ['#AC7F7C', '#C4A0A0'] },
    { id: 'sage',  name: '鼠尾草', dot: ['#75886F', '#A3B295'] },
    { id: 'mist',  name: '晨雾蓝', dot: ['#7C8FA0', '#9DB0BC'] },
    { id: 'ink',   name: '夜·墨',   dark: true, dot: ['#3A3941', '#B58F8B'] },
    { id: 'ocean', name: '夜·雾蓝', dark: true, dot: ['#2E3540', '#88A0B4'] }
  ];

  let switchTimer = 0;

  function apply(id) {
    if (!THEMES.some((t) => t.id === id)) return false;
    document.documentElement.setAttribute('data-theme', id);
    /* 主题切换时给全局颜色加过渡，结束后移除避免影响其他动画 */
    if (ET.utils.motionOK()) {
      document.body.classList.add('theming');
      clearTimeout(switchTimer);
      switchTimer = setTimeout(() => document.body.classList.remove('theming'), 400);
    }
    return true;
  }

  function init() {
    const saved = ET.store.prefsGet('theme', null);
    const valid = saved && THEMES.some((t) => t.id === saved);
    const id = valid ? saved
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'ink' : 'linen');
    apply(id);
    return id;
  }

  const current = () => document.documentElement.getAttribute('data-theme');

  /* 用户主动选择才持久化；未选择则保持跟随系统 */
  function select(id) {
    if (apply(id)) ET.store.prefsSet('theme', id);
  }

  return { THEMES: THEMES, init: init, current: current, select: select };
})();
