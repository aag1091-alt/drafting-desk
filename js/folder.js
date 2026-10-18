// Save posts straight into a folder on your computer (Chrome/Edge: File System Access API).
// The folder handle is kept in IndexedDB so you only pick it once; the browser
// asks again for permission when needed.

const DB = "dd-folder", STORE = "handles", KEY = "blog";

export const supported = typeof window.showDirectoryPicker === "function";

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function getHandle() {
  try {
    const db = await idb();
    return await new Promise((res) => { const t = db.transaction(STORE).objectStore(STORE).get(KEY); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); });
  } catch { return null; }
}
async function setHandle(h) {
  const db = await idb();
  await new Promise((res, rej) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(h, KEY); t.oncomplete = res; t.onerror = () => rej(t.error); });
}

export async function folderName() {
  const h = await getHandle();
  return h ? h.name : "";
}

export async function chooseFolder() {
  const h = await window.showDirectoryPicker({ id: "drafting-desk-blog", mode: "readwrite" });
  await setHandle(h);
  return h.name;
}

async function ensurePermission(h) {
  const opts = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return (await h.requestPermission(opts)) === "granted";
}

/** Write text to <folder>/<filename>. Returns the folder name. */
export async function saveToFolder(filename, text) {
  let h = await getHandle();
  if (!h) { await chooseFolder(); h = await getHandle(); }
  if (!(await ensurePermission(h))) throw new Error("The browser didn't get permission to write to that folder.");
  const file = await h.getFileHandle(filename, { create: true });
  const w = await file.createWritable();
  await w.write(text);
  await w.close();
  return h.name;
}
