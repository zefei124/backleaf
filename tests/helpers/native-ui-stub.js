"use strict";

// Minimal fakes of the Obsidian UI surface used by the Slice 2c native chat:
// DOM helpers (createEl / createDiv / empty / setText), ItemView, Component,
// MarkdownRenderer, PluginSettingTab, Setting (+ text / toggle / component),
// SecretComponent, workspace leaves, plugin data and a fake requestUrl.
// Installed into an obsidian-plugin-env environment only when `nativeUi` is set.

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.text = "";
    this.cls = [];
    this.attrs = {};
    this.listeners = {};
    this.dataset = {};
    this.value = "";
    this.disabled = false;
  }

  createEl(tag, options = {}, callback) {
    const el = new FakeElement(tag);
    if (options.cls) el.cls.push(...[].concat(options.cls));
    if (options.text != null) el.text = String(options.text);
    if (options.attr) Object.assign(el.attrs, options.attr);
    el.parent = this;
    this.children.push(el);
    if (callback) callback(el);
    return el;
  }

  createDiv(options, callback) {
    return this.createEl("div", options, callback);
  }

  createSpan(options, callback) {
    return this.createEl("span", options, callback);
  }

  empty() {
    this.children = [];
    this.text = "";
  }

  setText(text) {
    this.text = String(text);
  }

  addClass(cls) {
    this.cls.push(cls);
  }

  addEventListener(type, listener) {
    (this.listeners[type] = this.listeners[type] || []).push(listener);
  }

  trigger(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }

  get allText() {
    return [this.text, ...this.children.map((child) => child.allText)].filter(Boolean).join("\n");
  }

  findAll(predicate, found = []) {
    for (const child of this.children) {
      if (predicate(child)) found.push(child);
      child.findAll(predicate, found);
    }
    return found;
  }

  find(predicate) {
    return this.findAll(predicate)[0] || null;
  }

  hasClass(cls) {
    return this.cls.includes(cls);
  }
}

function install({ opts, record, obsidian, Plugin, app }) {
  Object.assign(record, {
    views: [],
    ribbons: [],
    settingTabs: [],
    settings: [],
    secrets: [],
    dataSaves: [],
    dataLoads: 0,
    markdown: [],
    requests: [],
    revealed: [],
    secretCalls: [],
  });

  class Component {
    constructor() {
      this._children = [];
    }
    addChild(child) {
      this._children.push(child);
      return child;
    }
    removeChild(child) {
      this._children = this._children.filter((item) => item !== child);
      return child;
    }
    register() {}
    load() {}
    unload() {}
  }

  class ItemView extends Component {
    constructor(leaf) {
      super();
      this.leaf = leaf;
      this.app = leaf.app;
      this.contentEl = new FakeElement("div");
    }
  }

  const MarkdownRenderer = {
    render(appArg, markdown, el, sourcePath, component) {
      record.markdown.push({ markdown, sourcePath, hasComponent: component instanceof Component });
      el.setText(markdown);
      return Promise.resolve();
    },
  };

  class TextComponent {
    setPlaceholder(value) {
      this.placeholder = value;
      return this;
    }
    setValue(value) {
      this.value = value;
      return this;
    }
    onChange(listener) {
      this.change = listener;
      return this;
    }
  }

  class ToggleComponent extends TextComponent {}

  class Setting {
    constructor(containerEl) {
      this.el = containerEl.createDiv({ cls: "setting-item" });
      this.components = [];
      record.settings.push(this);
    }
    setName(name) {
      this.name = name;
      this.el.createEl("div", { cls: "setting-item-name", text: name });
      return this;
    }
    setDesc(desc) {
      this.desc = desc;
      this.el.createEl("div", { cls: "setting-item-description", text: desc });
      return this;
    }
    setHeading() {
      this.heading = true;
      return this;
    }
    addText(callback) {
      const component = new TextComponent();
      component.kind = "text";
      this.components.push(component);
      callback(component);
      return this;
    }
    addToggle(callback) {
      const component = new ToggleComponent();
      component.kind = "toggle";
      this.components.push(component);
      callback(component);
      return this;
    }
    addComponent(callback) {
      const component = callback(this.el.createDiv());
      this.components.push(component);
      return this;
    }
  }

  class SecretComponent {
    constructor(appArg, el) {
      this.app = appArg;
      this.el = el;
      this.kind = "secret";
      record.secrets.push(this);
    }
    setValue(value) {
      this.value = value;
      return this;
    }
    onChange(listener) {
      this.change = listener;
      return this;
    }
  }

  class PluginSettingTab {
    constructor(appArg, plugin) {
      this.app = appArg;
      this.plugin = plugin;
      this.containerEl = new FakeElement("div");
    }
  }

  // Network: nothing is answered unless the test queues a reply.
  const replies = [];
  const requestUrl = async (request) => {
    record.requests.push(request);
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected network request in test");
    return typeof reply === "function" ? reply(request) : reply;
  };
  requestUrl.reply = (reply) => replies.push(reply);

  Object.assign(obsidian, { Component, ItemView, MarkdownRenderer, PluginSettingTab, Setting, SecretComponent, requestUrl });

  // Plugin API used by the native chat wiring.
  let stored = opts.pluginData === undefined ? null : JSON.parse(JSON.stringify(opts.pluginData));
  Object.assign(Plugin.prototype, {
    registerView(type, creator) {
      record.views.push({ type, creator });
    },
    addRibbonIcon(icon, title, callback) {
      record.ribbons.push({ icon, title, callback });
      return new FakeElement("div");
    },
    addSettingTab(tab) {
      record.settingTabs.push(tab);
    },
    async loadData() {
      record.dataLoads += 1;
      return stored === null ? null : JSON.parse(JSON.stringify(stored));
    },
    async saveData(data) {
      stored = JSON.parse(JSON.stringify(data));
      record.dataSaves.push(stored);
    },
  });

  // SecretStorage: only getSecret is expected to be used.
  const secrets = { ...(opts.secrets || {}) };
  app.secretStorage = {
    getSecret(id) {
      record.secretCalls.push(["getSecret", id]);
      return Object.prototype.hasOwnProperty.call(secrets, id) ? secrets[id] : null;
    },
    setSecret(id, value) {
      record.secretCalls.push(["setSecret", id]);
      secrets[id] = value;
    },
    listSecrets() {
      record.secretCalls.push(["listSecrets"]);
      return Object.keys(secrets);
    },
  };

  // Workspace leaves for the chat view.
  const leaves = [];
  Object.assign(app.workspace, {
    getLeavesOfType(type) {
      return leaves.filter((leaf) => leaf.view && leaf.view.getViewType() === type);
    },
    getRightLeaf() {
      return {
        app,
        view: null,
        async setViewState(state) {
          const registered = record.views.find((view) => view.type === state.type);
          this.view = registered.creator(this);
          leaves.push(this);
          await this.view.onOpen();
        },
      };
    },
    async revealLeaf(leaf) {
      record.revealed.push(leaf);
    },
  });

  return { FakeElement, requestUrl, secrets, leaves, get data() { return stored; } };
}

module.exports = {
  FakeElement,
  install,
};
