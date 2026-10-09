/* ============================================================
   EasyTodo · filestore.js
   本地文件存储：File System Access API（Chrome/Edge）
   数据文件 easytodo-data.json 落盘到用户绑定的文件夹；
   localStorage 始终同步兜底（双保险）。
   ============================================================ */
window.ET = window.ET || {};

ET.fileStore = (function () {
  'use strict';

  const FILE_NAME = 'easytodo-data.json';
  const DB_NAME = 'easytodo-fs';
  const STORE = 'handles';

  let dirHandle = null;
  let writable = false;
  let writeTimer = 0;
  let status = { state: 'unsupported', name: '' }; /* ready | prompt | unbound | unsupported */

  const supported = () => 'showDirectoryPicker' in window;

  /* ---------- IndexedDB：跨会话持久化目录句柄 ---------- */
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
      };
    });
  }
  const idbGet = (k) => idb('readonly', (s) => s.get(k));
  const idbSet = (k, v) => idb('readwrite', (s) => s.put(v, k));
  const idbDel = (k) => idb('readwrite', (s) => s.delete(k));

  function setState(state, name) {
    status = { state: state, name: name || '' };
    return status;
  }

  /* ---------- 从数据文件恢复到内存，返回恢复条数 ---------- */
  async function loadFromFile() {
    if (!dirHandle || !writable) return 0;
    try {
      const fh = await dirHandle.getFileHandle(FILE_NAME, { create: false });
      const obj = JSON.parse(await (await fh.getFile()).text());
      return ET.store.importData(obj, { silentFile: true });
    } catch (e) {
      return 0;
    }
  }

  /* ---------- 启动：尝试恢复上次绑定的文件夹（无阻塞，不弹窗） ---------- */
  async function init() {
    if (!supported()) return setState('unsupported');
    try { dirHandle = await idbGet('dir'); } catch (e) { dirHandle = null; }
    if (!dirHandle) return setState('unbound');
    try {
      const p = await dirHandle.queryPermission({ mode: 'readwrite' });
      if (p !== 'granted') return setState('prompt', dirHandle.name);
      writable = true;
      const n = await loadFromFile();
      if (n === 0) await write(ET.store.serializeFile());
      setState('ready', dirHandle.name);
      return { state: 'ready', name: dirHandle.name, loaded: n };
    } catch (e) {
      return setState('prompt', dirHandle.name);
    }
  }

  /* ---------- 用户手势中调用：绑定文件夹 / 恢复授权 / 重新选择 ---------- */
  async function connect(rebind) {
    if (!supported()) return setState('unsupported');
    if (rebind) { dirHandle = null; writable = false; }

    if (dirHandle) {
      try {
        const p = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (p !== 'granted') return setState('prompt', dirHandle.name);
      } catch (e) {
        return setState('prompt', dirHandle.name);
      }
      writable = true;
      const n = await loadFromFile();
      setState('ready', dirHandle.name);
      return { state: 'ready', name: dirHandle.name, loaded: n };
    }

    try {
      dirHandle = await showDirectoryPicker({ id: 'easytodo', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      return setState('unbound');
    }
    try { await idbSet('dir', dirHandle); } catch (e) { /* 句柄持久化失败不阻塞 */ }
    writable = true;
    /* 首次绑定：文件已存在则读取恢复，否则把当前数据写入文件 */
    const n = await loadFromFile();
    if (n === 0) await write(ET.store.serializeFile());
    setState('ready', dirHandle.name);
    return { state: 'ready', name: dirHandle.name, loaded: n };
  }

  async function unbind() {
    dirHandle = null;
    writable = false;
    try { await idbDel('dir'); } catch (e) { /* ignore */ }
    return setState('unbound');
  }

  /* ---------- 写入数据文件（载荷由 store 序列化：v2 树结构） ---------- */
  async function write(payload) {
    if (!dirHandle || !writable) return;
    try {
      const fh = await dirHandle.getFileHandle(FILE_NAME, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(payload, null, 2));
      await w.close();
    } catch (e) { /* 写失败时静默，localStorage 兜底 */ }
  }
  function writeSoon() {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => write(ET.store.serializeFile()), 400);
  }

  /* ---------- 导出 / 导入（不依赖文件夹绑定） ---------- */
  function exportJSON() {
    const payload = ET.store.serializeFile();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = 'easytodo-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  async function importJSON(file) {
    const obj = JSON.parse(await file.text());
    return ET.store.importData(obj);
  }

  /* ---------- 打开数据文件夹（file:// 模式下由浏览器展示目录） ---------- */
  function openFolder() {
    if (location.protocol !== 'file:') {
      ET.toast('请通过双击 index.html 打开应用后再使用');
      return;
    }
    const a = document.createElement('a');
    a.href = location.href.replace(/[^/]*$/, '');
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* 绑定的文件夹与页面目录不同名时给出提示 */
    const pageDir = decodeURIComponent(
      location.pathname.replace(/\/[^/]*$/, '').split('/').pop() || '');
    if (dirHandle && dirHandle.name && dirHandle.name !== pageDir) {
      ET.toast('数据文件位于「' + dirHandle.name + '」文件夹内');
    }
  }

  return {
    supported: supported,
    init: init,
    connect: connect,
    unbind: unbind,
    writeSoon: writeSoon,
    exportJSON: exportJSON,
    importJSON: importJSON,
    openFolder: openFolder,
    get status() { return status; },
    get writable() { return writable; }
  };
})();
