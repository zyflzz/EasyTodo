/* ============================================================
   EasyTodo · filestore.js
   本地文件存储：File System Access API（Chrome/Edge）
   数据文件 easytodo-data.json 落盘到用户绑定的文件夹；
   localStorage 始终同步兜底（双保险）。
   ============================================================ */
window.ET = window.ET || {};

ET.fileStore = (function () {
  'use strict';

  const SUBDIR = 'data';
  const FILE_NAME = 'easytodo-data.json';
  const DB_NAME = 'easytodo-fs';
  const STORE = 'handles';

  let dirHandle = null;
  let dataDir = null;   /* 绑定目录下的 data 子目录（数据文件实际所在） */
  let migrated = false; /* 本次启动是否发生了旧版数据迁移 */
  let writable = false;
  let writeTimer = 0;
  let status = { state: 'unsupported', name: '' }; /* ready | prompt | unbound | unsupported */

  const supported = () => 'showDirectoryPicker' in window;

  /* 解析/创建 data 子目录（数据文件统一存放在 <绑定目录>/data/ 下） */
  async function resolveDataDir(create) {
    if (!dirHandle) return null;
    /* 防呆：用户直接绑定了名为 data 的目录，它本身就是数据目录，不再嵌套创建 */
    if (dirHandle.name === SUBDIR) {
      dataDir = dirHandle;
      return dataDir;
    }
    try {
      dataDir = await dirHandle.getDirectoryHandle(SUBDIR, { create: !!create });
      return dataDir;
    } catch (e) {
      return null;
    }
  }

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

  /* ---------- 从数据文件恢复到内存，返回恢复条数 ----------
     查找顺序：data/easytodo-data.json（新版）
             → 根目录 easytodo-data.json（旧版，读出后迁移到 data/） */
  async function loadFromFile() {
    if (!dirHandle || !writable) return 0;
    migrated = false;
    const dir = await resolveDataDir(true);
    if (!dir) return 0;

    /* 1) 新版位置 */
    try {
      const fh = await dir.getFileHandle(FILE_NAME, { create: false });
      const obj = JSON.parse(await (await fh.getFile()).text());
      return ET.store.importData(obj, { silentFile: true });
    } catch (e) { /* 不存在或损坏，继续尝试旧版位置 */ }

    /* 2) 旧版过渡：读根目录旧文件 → 写入 data/ → 旧文件改写为迁移标记 */
    try {
      const oldFh = await dirHandle.getFileHandle(FILE_NAME, { create: false });
      const obj = JSON.parse(await (await oldFh.getFile()).text());
      const n = ET.store.importData(obj, { silentFile: true });
      await write(ET.store.serializeFile());
      const w = await oldFh.createWritable();
      await w.write(JSON.stringify({
        migrated: true,
        note: 'EasyTodo 数据已迁移至 data/easytodo-data.json，本文件可删除。',
        migratedAt: ET.utils.isoLocal(new Date())
      }, null, 2));
      await w.close();
      migrated = true;
      return n;
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
      return { state: 'ready', name: dirHandle.name, loaded: n, migrated: migrated };
    } catch (e) {
      return setState('prompt', dirHandle.name);
    }
  }

  /* ---------- 用户手势中调用：绑定文件夹 / 恢复授权 / 重新选择 ---------- */
  let connecting = false; /* 自动恢复与手动点击并发时只执行一次 */
  async function connect(rebind) {
    if (connecting) return status;
    connecting = true;
    try {
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
        return { state: 'ready', name: dirHandle.name, loaded: n, migrated: migrated };
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
      return { state: 'ready', name: dirHandle.name, loaded: n, migrated: migrated };
    } finally {
      connecting = false;
    }
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
    const dir = dataDir || (await resolveDataDir(true));
    if (!dir) return;
    try {
      const fh = await dir.getFileHandle(FILE_NAME, { create: true });
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
      ET.toast('请通过双击 EasyTodo.html 打开应用后再使用');
      return;
    }
    const a = document.createElement('a');
    a.href = location.href.replace(/[^/]*$/, '') + 'data/';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* 绑定的文件夹与页面目录不同名时给出提示 */
    const pageDir = decodeURIComponent(
      location.pathname.replace(/\/[^/]*$/, '').split('/').pop() || '');
    if (dirHandle && dirHandle.name && dirHandle.name !== pageDir) {
      ET.toast('数据文件位于「' + dirHandle.name + '」文件夹的 data 子目录');
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
    get writable() { return writable; },
    get migrated() { return migrated; }
  };
})();
