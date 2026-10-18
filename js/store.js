/* ============================================================
   EasyTodo · store.js
   数据层：以日期为索引的桶结构（年→月→日 树形序列化）
   · 运行时：buckets Map<dateStr, Todo[]>，单日/区间查询 O(1)/O(区间)
   · 时间字段：ISO 8601 本地时区格式（2024-05-30T14:30:00+08:00），
     读取旧数据（毫秒时间戳）时自动迁移
   · 持久化：localStorage 扁平兜底 + easytodo-data.json 树结构（v2）
   ============================================================ */
window.ET = window.ET || {};

ET.store = (function () {
  'use strict';

  const KEY = 'easytodo.todos.v1';
  const SKEY = 'easytodo.settings.v1';
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  let buckets = new Map(); /* 'YYYY-MM-DD' -> Todo[]（桶内保持插入序，查询时排序） */
  let idMap = new Map();   /* id -> Todo */
  let saveTimer = 0;

  const U = ET.utils;

  /* ---------- 归一化：校验 + 旧时间戳迁移为 ISO 格式 ---------- */
  function normalizeTodo(raw) {
    if (!raw || !raw.id || typeof raw.title !== 'string' || typeof raw.date !== 'string') return null;
    if (!DATE_RE.test(raw.date)) return null;
    const toIso = (v, fallback) => {
      if (typeof v === 'number') return U.isoLocal(new Date(v));
      if (typeof v === 'string' && v) return v;
      return fallback;
    };
    const t = {
      id: raw.id,
      title: raw.title,
      date: raw.date,
      done: !!raw.done,
      createdAt: toIso(raw.createdAt, U.isoLocal(new Date()))
    };
    if (t.done) t.completedAt = toIso(raw.completedAt, t.createdAt);
    return t;
  }

  function insert(t) {
    let b = buckets.get(t.date);
    if (!b) { b = []; buckets.set(t.date, b); }
    b.push(t);
    idMap.set(t.id, t);
  }

  /* ---------- 持久化 ---------- */
  /* 扁平快照（按日期有序），用于 localStorage 兜底 */
  function flatAll() {
    const out = [];
    for (const date of Array.from(buckets.keys()).sort()) out.push(...buckets.get(date));
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(flatAll())); } catch (e) { /* 存储满时忽略 */ }
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      save();
      /* 已绑定本地文件夹时同步写数据文件（localStorage 始终兜底） */
      if (ET.fileStore && ET.fileStore.writable) ET.fileStore.writeSoon();
    }, 300);
  }

  /* ---------- 树形序列化（B+ 树形态：叶子按日期有序，内部节点带 count 聚合） ---------- */
  function serializeTree() {
    const tree = {};
    const dates = Array.from(buckets.keys()).sort();
    for (const date of dates) {
      const arr = buckets.get(date);
      if (!arr || !arr.length) continue;
      const y = date.slice(0, 4), m = date.slice(5, 7), d = date.slice(8, 10);
      const yn = tree[y] || (tree[y] = { count: 0, months: {} });
      const mn = yn.months[m] || (yn.months[m] = { count: 0, days: {} });
      mn.days[d] = { count: arr.length, todos: arr };
      mn.count += arr.length;
      yn.count += arr.length;
    }
    return tree;
  }

  /* 数据文件载荷：v2 树结构 */
  function serializeFile() {
    return {
      version: 2,
      savedAt: U.isoLocal(new Date()),
      index: { type: 'date-tree', tree: serializeTree() }
    };
  }

  /* 树 → 扁平（读取 v2 文件） */
  function flattenTree(tree) {
    const out = [];
    for (const y in tree) {
      const months = (tree[y] && tree[y].months) || {};
      for (const m in months) {
        const days = (months[m] && months[m].days) || {};
        for (const d in days) {
          const node = days[d];
          if (node && Array.isArray(node.todos)) out.push(...node.todos);
          else if (Array.isArray(node)) out.push(...node);
        }
      }
    }
    return out;
  }

  /* 导入任意支持的格式（v2 树 / v1 扁平 {todos} / v1 纯数组） */
  function importData(obj, opts) {
    let arr = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && Array.isArray(obj.todos)) arr = obj.todos;
    else if (obj && obj.index && obj.index.tree) arr = flattenTree(obj.index.tree);
    else if (obj && obj.tree) arr = flattenTree(obj.tree);
    if (arr === null) throw new Error('无法识别的数据格式');
    return replaceAll(arr, opts);
  }

  /* 整体替换（数据文件恢复 / 导入备份）；silentFile=true 时不回写文件避免回环 */
  function replaceAll(arr, opts) {
    buckets = new Map();
    idMap = new Map();
    let n = 0;
    for (const raw of (Array.isArray(arr) ? arr : [])) {
      const t = normalizeTodo(raw);
      if (t) { insert(t); n++; }
    }
    save();
    if (!opts || !opts.silentFile) {
      if (ET.fileStore && ET.fileStore.writable) ET.fileStore.writeSoon();
    }
    return n;
  }

  /* ---------- 启动加载（localStorage 兜底数据，含旧格式迁移） ---------- */
  (function load() {
    try {
      const arr = JSON.parse(localStorage.getItem(KEY));
      if (Array.isArray(arr)) replaceAll(arr, { silentFile: true });
    } catch (e) { /* 数据损坏时静默重置 */ }
  })();

  /* 关键时机立即落盘 */
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  /* ---------- 查询与排序 ---------- */
  /* ISO 定宽字符串：字典序即时间序 */
  function cmp(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done) {
      const ca = a.completedAt || '', cb = b.completedAt || '';
      return ca < cb ? -1 : ca > cb ? 1 : 0;
    }
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  }

  function add(date, title) {
    const t = {
      id: U.uid(), title: title, date: date, done: false,
      createdAt: U.isoLocal(new Date())
    };
    insert(t);
    saveSoon();
    return t;
  }

  function remove(id) {
    const t = idMap.get(id);
    if (!t) return null;
    const b = buckets.get(t.date);
    const i = b ? b.indexOf(t) : -1;
    if (i > -1) b.splice(i, 1);
    if (b && !b.length) buckets.delete(t.date);
    idMap.delete(id);
    saveSoon();
    return t;
  }

  function restore(t) {
    const n = normalizeTodo(t);
    if (!n) return;
    insert(n);
    saveSoon();
  }

  function toggle(id) {
    const t = idMap.get(id);
    if (t) {
      t.done = !t.done;
      if (t.done) t.completedAt = U.isoLocal(new Date());
      else delete t.completedAt;
      saveSoon();
    }
    return t;
  }

  function rename(id, title) {
    const t = idMap.get(id);
    if (t && title) {
      t.title = title;
      saveSoon();
    }
    return t;
  }

  /* 移动任务到另一天（保留 createdAt 等所有字段；用于把过去未完成的任务顺延到今天） */
  function moveTo(id, newDate) {
    const t = idMap.get(id);
    if (!t || t.date === newDate || !DATE_RE.test(newDate)) return null;
    const b = buckets.get(t.date);
    const i = b ? b.indexOf(t) : -1;
    if (i > -1) b.splice(i, 1);
    if (b && !b.length) buckets.delete(t.date);
    t.date = newDate;
    insert(t);
    saveSoon();
    return t;
  }

  /* 单日查询 O(1)（返回排序副本） */
  const byDate = (date) => {
    const arr = buckets.get(date);
    return arr ? arr.slice().sort(cmp) : [];
  };

  /* 日期闭区间查询（月视图 42 天网格 / 年视图） */
  function forRange(start, end) {
    const out = [];
    for (const [d, arr] of buckets) {
      if (d >= start && d <= end) out.push(...arr);
    }
    return out;
  }

  function countByDate(date) {
    const arr = buckets.get(date);
    let done = 0;
    if (arr) for (const t of arr) { if (t.done) done++; }
    return { n: arr ? arr.length : 0, done: done };
  }

  function search(q) {
    q = q.toLowerCase();
    const hits = [];
    for (const arr of buckets.values()) {
      for (const t of arr) {
        if (t.title.toLowerCase().includes(q)) hits.push(t);
      }
    }
    return hits.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : cmp(a, b)));
  }

  /* ---------- 偏好设置 ---------- */
  function prefsGet(k, d) {
    try {
      const s = JSON.parse(localStorage.getItem(SKEY) || '{}');
      return k in s ? s[k] : d;
    } catch (e) { return d; }
  }
  function prefsSet(k, v) {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { /* ignore */ }
    s[k] = v;
    try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  return {
    add: add, remove: remove, restore: restore,
    toggle: toggle, rename: rename, moveTo: moveTo,
    byDate: byDate, forRange: forRange, countByDate: countByDate,
    search: search,
    importData: importData, serializeFile: serializeFile,
    prefsGet: prefsGet, prefsSet: prefsSet,
    flush: save
  };
})();
