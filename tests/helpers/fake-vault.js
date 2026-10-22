"use strict";

// Minimal in-memory stand-in for the parts of the Obsidian Vault API used by
// ReadingNoteWriter. Paths are vault-relative and "/"-separated, like Obsidian's.

class FakeTAbstractFile {
  constructor(vault, path) {
    this.vault = vault;
    this.path = path;
  }

  get name() {
    return this.path.split("/").pop();
  }

  get parent() {
    const index = this.path.lastIndexOf("/");
    return this.vault.getAbstractFileByPath(index === -1 ? "/" : this.path.slice(0, index));
  }
}

class FakeTFile extends FakeTAbstractFile {
  get basename() {
    const name = this.name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  get extension() {
    const name = this.name;
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1) : "";
  }
}

class FakeTFolder extends FakeTAbstractFile {
  get children() {
    const prefix = this.path === "/" ? "" : `${this.path}/`;
    const children = [];
    for (const key of this.vault.entries.keys()) {
      if (key === "/" || !key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest && !rest.includes("/")) children.push(this.vault.getAbstractFileByPath(key));
    }
    return children;
  }
}

// Same algorithm as Obsidian's normalizePath().
function normalizePath(path) {
  let value = String(path).replace(/([\\/])+/g, "/").replace(/(^\/+|\/+$)/g, "");
  if (value === "") value = "/";
  return value.replace(/ | /g, " ").normalize("NFC");
}

class FakeVault {
  constructor({ caseInsensitive = false, configDir = ".obsidian" } = {}) {
    this.caseInsensitive = caseInsensitive;
    this.configDir = configDir;
    this.entries = new Map([["/", { kind: "folder" }]]);
    this.log = [];
    this.hooks = {};
    this.listeners = {};
  }

  // Obsidian Events surface (on / offref). Events are only fired by tests, via trigger().
  on(name, callback) {
    (this.listeners[name] = this.listeners[name] || []).push(callback);
    return { name, callback };
  }

  offref(ref) {
    const list = (ref && this.listeners[ref.name]) || [];
    const index = list.indexOf(ref.callback);
    if (index >= 0) list.splice(index, 1);
  }

  findKey(path) {
    if (this.entries.has(path)) return path;
    if (!this.caseInsensitive) return null;
    const lower = path.toLowerCase();
    for (const key of this.entries.keys()) {
      if (key.toLowerCase() === lower) return key;
    }
    return null;
  }

  parentPath(path) {
    const index = path.lastIndexOf("/");
    return index === -1 ? "/" : path.slice(0, index);
  }

  requireParentFolder(path) {
    const parent = this.entries.get(this.parentPath(path));
    if (!parent || parent.kind !== "folder") throw new Error(`Parent folder missing: ${path}`);
  }

  // Obsidian's lookup is exact (case-sensitive) even on case-insensitive disks.
  getAbstractFileByPath(path) {
    const entry = this.entries.get(path);
    if (!entry) return null;
    return entry.kind === "file" ? new FakeTFile(this, path) : new FakeTFolder(this, path);
  }

  async createFolder(path) {
    this.log.push({ op: "createFolder", path });
    if (this.findKey(path)) throw new Error("Folder already exists.");
    this.requireParentFolder(path);
    this.entries.set(path, { kind: "folder" });
  }

  async create(path, data) {
    if (this.hooks.beforeCreate) await this.hooks.beforeCreate(path);
    this.log.push({ op: "create", path });
    if (this.findKey(path)) throw new Error("File already exists.");
    this.requireParentFolder(path);
    this.entries.set(path, { kind: "file", content: String(data) });
    return this.getAbstractFileByPath(path);
  }

  async read(file) {
    const entry = this.entries.get(file.path);
    if (!entry || entry.kind !== "file") throw new Error(`No such file: ${file.path}`);
    return entry.content;
  }

  async process(file, fn) {
    const entry = this.entries.get(file.path);
    if (!entry || entry.kind !== "file") throw new Error(`No such file: ${file.path}`);
    if (this.hooks.beforeProcess) await this.hooks.beforeProcess(file.path);
    const next = fn(entry.content);
    if (typeof next !== "string") throw new Error("process callback must return a string");
    this.log.push({ op: "process", path: file.path });
    entry.content = next;
    return next;
  }

  // ---- test setup / inspection helpers (not part of the Obsidian API) ----

  seedFolder(path) {
    let current = "";
    for (const segment of path.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.entries.has(current)) this.entries.set(current, { kind: "folder" });
    }
  }

  seedFile(path, content) {
    const parent = this.parentPath(path);
    if (parent !== "/") this.seedFolder(parent);
    this.entries.set(path, { kind: "file", content: String(content) });
  }

  readFile(path) {
    const entry = this.entries.get(path);
    return entry && entry.kind === "file" ? entry.content : null;
  }

  setFile(path, content) {
    const entry = this.entries.get(path);
    if (!entry || entry.kind !== "file") throw new Error(`No such file: ${path}`);
    entry.content = String(content);
  }

  // Direct children of a folder: [{ name, kind, content? }] sorted by name.
  list(folderPath) {
    const folder = this.getAbstractFileByPath(folderPath);
    if (!folder || !(folder instanceof FakeTFolder)) return [];
    return folder.children
      .map((child) => {
        const entry = this.entries.get(child.path);
        return entry.kind === "file"
          ? { name: child.name, kind: "file", content: entry.content }
          : { name: child.name, kind: "folder" };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  writes() {
    return this.log.filter((item) => item.op === "create" || item.op === "process");
  }

  // Fire a vault event the way Obsidian would (modify / delete: file; rename: file, oldPath).
  trigger(name, ...args) {
    for (const callback of (this.listeners[name] || []).slice()) callback(...args);
  }

  listenerCount(name) {
    return (this.listeners[name] || []).length;
  }

  // What the user does in Obsidian outside Backleaf: delete or rename a note.
  removeFile(path) {
    const file = new FakeTFile(this, path);
    this.entries.delete(path);
    return file;
  }

  renameFile(oldPath, newPath) {
    const entry = this.entries.get(oldPath);
    if (!entry || entry.kind !== "file") throw new Error(`No such file: ${oldPath}`);
    const parent = this.parentPath(newPath);
    if (parent !== "/") this.seedFolder(parent);
    this.entries.delete(oldPath);
    this.entries.set(newPath, entry);
    return new FakeTFile(this, newPath);
  }
}

module.exports = {
  FakeVault,
  FakeTFile,
  FakeTFolder,
  normalizePath,
};
