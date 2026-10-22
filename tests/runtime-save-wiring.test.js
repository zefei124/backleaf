"use strict";

// Slice 1c runtime wiring in the generated root main.js: the plugin owns one reading
// context store and one save service, captures the context only after Copilot accepted
// the selection, and never lets that plugin-side work change Phase 1 behavior.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  PHASE1_MAIN,
  BUILT_MAIN,
  assertFreshBuild,
  runPlugin,
} = require("./helpers/obsidian-plugin-env");
const { createLegacyEngine } = require("./helpers/reading-note-engines");
const { buildPayloadFromContext } = require("../src/reading-notes/reading-context");

test.before(() => assertFreshBuild());

// Objects created inside the vm realm are compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

function withoutDiscussionMarkers(value) {
  if (typeof value === "string") {
    return value.replace(/^<!-- backleaf:discussion id=bl_[0-9a-f-]+ -->\r?\n/gim, "");
  }
  if (Array.isArray(value)) return value.map(withoutDiscussionMarkers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutDiscussionMarkers(item)]));
  }
  return value;
}

function normalizeCommandBrand(snapshot) {
  return {
    ...snapshot,
    commands: snapshot.commands
      .filter((command) => command.id !== "generate-thought-tree-archive")
      .map((command) =>
        command.id === "send-pdf-selection-to-agent" ? { ...command, name: "<brand-localized>" } : command,
      ),
  };
}

const EXPECTED_CONTEXT = {
  id: "uuid-1",
  originalText: "Selected passage.",
  bookTitle: "《书A》",
  chapter: "Part One｜Chapter 2",
  sourceLink: "[[Books/《书A（修订版）》.pdf#page=10&selection=1,0,1,12|Open source]]",
  filePath: "Books/《书A（修订版）》.pdf",
  fileMtime: 1,
};

function withoutTime(context) {
  const { capturedAt, ...rest } = plain(context);
  assert.equal(typeof capturedAt, "number");
  return rest;
}

test("onload exposes one save service with an empty context store", async () => {
  await runPlugin(BUILT_MAIN, {}, async ({ plugin }) => {
    const notes = plugin.readingNotes;
    assert.ok(notes, "readingNotes exists");
    assert.equal(typeof notes.save, "function");
    assert.equal(typeof notes.saveFromContext, "function");
    assert.equal(notes.getCurrentContext(), null);
    assert.equal(notes.writer.vault, plugin.app.vault, "writer uses the plugin's vault");
    assert.equal(typeof notes.writer.save, "function");
  });
});

test("successful Ctrl+R captures exactly what was sent to Copilot", async () => {
  await runPlugin(BUILT_MAIN, {}, async (ctx) => {
    await ctx.pressKey({ ctrlKey: true });
    const context = ctx.plugin.readingNotes.getCurrentContext();
    assert.deepEqual(withoutTime(context), EXPECTED_CONTEXT);

    const [sentItem] = ctx.env.record.copilotCalls.filter((call) => call.op === "setSelectionContext");
    assert.equal(context.id, sentItem.item.id);
    assert.ok(sentItem.item.content.includes(`<selected-text>\n${context.originalText}\n</selected-text>`));
    assert.ok(sentItem.item.content.includes(`<book>${context.bookTitle}</book>`));
    assert.ok(sentItem.item.content.includes(`<chapter>${context.chapter}</chapter>`));
    assert.ok(sentItem.item.content.includes(`<link>${context.sourceLink}</link>`));
  });
});

test("a later selection overwrites the context; empty chapter is kept as empty", async () => {
  await runPlugin(BUILT_MAIN, {}, async (ctx) => {
    await ctx.runCommand();
    ctx.env.file.stat.mtime = 5;
    ctx.env.opts.outline = [];
    await ctx.runCommand();
    const context = plain(ctx.plugin.readingNotes.getCurrentContext());
    assert.equal(context.id, "uuid-2");
    assert.equal(context.fileMtime, 5);
    assert.equal(context.chapter, "");
  });
});

test("no capture when Copilot is missing, incompatible, or rejects the selection", async () => {
  for (const copilot of ["missing", "noSetSelection", "noActivate", "setThrowsString"]) {
    await runPlugin(BUILT_MAIN, { copilot }, async (ctx) => {
      await ctx.runCommand();
      assert.equal(ctx.plugin.readingNotes.getCurrentContext(), null, copilot);
    });
  }
  for (const state of [{ file: null }, { selectionText: "" }]) {
    await runPlugin(BUILT_MAIN, state, async (ctx) => {
      await ctx.runCommand();
      await ctx.pressKey({ ctrlKey: true });
      assert.equal(ctx.plugin.readingNotes.getCurrentContext(), null, JSON.stringify(state));
    });
  }
});

test("a failing setSelectionContext keeps the previous context unchanged", async () => {
  await runPlugin(BUILT_MAIN, {}, async (ctx) => {
    await ctx.runCommand();
    const before = ctx.plugin.readingNotes.getCurrentContext();
    ctx.env.app.plugins.plugins.copilot.setSelectionContext = () => {
      throw new Error("rejected");
    };
    await ctx.runCommand();
    assert.equal(ctx.plugin.readingNotes.getCurrentContext(), before);
    assert.deepEqual(ctx.env.record.notices, ["Failed to send: rejected"]);
  });
});

test("activateAgentView failing after an accepted selection still captures it", async () => {
  await runPlugin(BUILT_MAIN, { copilot: "activateThrows" }, async (ctx) => {
    await ctx.runCommand();
    assert.equal(ctx.plugin.readingNotes.getCurrentContext().id, "uuid-1");
    assert.deepEqual(ctx.env.record.notices, ["Failed to send: boom"]);
  });
});

test("a throwing context capture does not change Ctrl+R, Copilot calls or Notices", async () => {
  const scenarios = [
    ["ctrl+r", {}, (ctx) => ctx.pressKey({ ctrlKey: true })],
    ["command", {}, (ctx) => ctx.runCommand()],
    ["command zh", { locale: "zh-CN" }, (ctx) => ctx.runCommand()],
    ["activate throws", { copilot: "activateThrows" }, (ctx) => ctx.runCommand()],
  ];
  for (const [label, options, action] of scenarios) {
    const legacy = await runPlugin(PHASE1_MAIN, options, action);
    let attempts = 0;
    const built = await runPlugin(BUILT_MAIN, options, async (ctx) => {
      ctx.plugin.readingNotes.contextStore.capture = () => {
        attempts += 1;
        throw new Error("capture failed");
      };
      const outcome = await action(ctx);
      assert.equal(ctx.plugin.readingNotes.getCurrentContext(), null, label);
      return outcome;
    });
    assert.equal(attempts, 1, `${label}: capture attempted once`);
    assert.deepEqual(normalizeCommandBrand(built.snapshot), normalizeCommandBrand(legacy.snapshot), label);
  }
});

test("a failing reading-notes setup leaves the Phase 1 runtime intact", async () => {
  const options = { omitObsidianExports: ["TFile"] };
  const legacy = await runPlugin(PHASE1_MAIN, options, (ctx) => ctx.pressKey({ ctrlKey: true }));
  const built = await runPlugin(BUILT_MAIN, options, async (ctx) => {
    assert.equal(ctx.plugin.readingNotes, null);
    return ctx.pressKey({ ctrlKey: true });
  });
  assert.deepEqual(normalizeCommandBrand(built.snapshot), normalizeCommandBrand(legacy.snapshot));
  assert.equal(built.snapshot.copilotCalls.length, 2);
});

test("onunload clears the context", async () => {
  await runPlugin(BUILT_MAIN, {}, async (ctx) => {
    await ctx.runCommand();
    assert.ok(ctx.plugin.readingNotes.getCurrentContext());
    ctx.plugin.onunload();
    assert.equal(ctx.plugin.readingNotes.getCurrentContext(), null);
  });
});

test("capturing never writes to the vault or persists plugin data", async () => {
  await runPlugin(BUILT_MAIN, {}, async (ctx) => {
    await ctx.runCommand();
    await ctx.pressKey({ ctrlKey: true });
    assert.deepEqual(ctx.env.app.vault.log, []);
    assert.deepEqual([...ctx.env.app.vault.entries.keys()], ["/"]);
  });

  // Since Slice 2c the bundle legitimately uses loadData/saveData for native chat
  // settings, so persistence is checked at runtime instead: the Ctrl+R -> Copilot
  // capture path must never call saveData.
  await runPlugin(BUILT_MAIN, { nativeUi: true }, async (ctx) => {
    await ctx.runCommand();
    await ctx.pressKey({ ctrlKey: true });
    assert.ok(ctx.plugin.readingNotes.getCurrentContext(), "the context was captured");
    assert.deepEqual(ctx.env.record.dataSaves, [], "capturing a reading context calls saveData 0 times");
    assert.deepEqual(ctx.env.app.vault.log, []);
  });

  const bundle = fs.readFileSync(BUILT_MAIN, "utf8");
  assert.doesNotMatch(bundle, /localStorage|sessionStorage|indexedDB/);
});

test("saveFromContext writes through the Vault API like the legacy tool; stale ids write nothing", async () => {
  const discussion = { topic: "Topic", question: "Why does this matter?", dialogue: "**AI：** because" };
  const legacy = await createLegacyEngine();
  try {
    await runPlugin(BUILT_MAIN, {}, async (ctx) => {
      await ctx.runCommand();
      const context = ctx.plugin.readingNotes.getCurrentContext();
      const expected = await legacy.save(buildPayloadFromContext(plain(context), discussion));

      const outcome = plain(await ctx.plugin.readingNotes.saveFromContext(context.id, discussion));
      assert.deepEqual(withoutDiscussionMarkers(outcome), withoutDiscussionMarkers(expected));
      assert.equal(outcome.status, "saved");
      assert.deepEqual(
        withoutDiscussionMarkers(ctx.env.app.vault.list("Books/Reading Notes")),
        withoutDiscussionMarkers(legacy.list()),
      );

      assert.equal(plain(await ctx.plugin.readingNotes.saveFromContext(context.id, discussion)).status, "duplicate");

      await ctx.runCommand();
      const writes = ctx.env.app.vault.writes().length;
      assert.deepEqual(plain(await ctx.plugin.readingNotes.saveFromContext(context.id, discussion)), {
        status: "error",
        path: "",
        message: "Reading context is stale: a newer PDF selection has been sent since this discussion started.",
      });
      assert.equal(ctx.env.app.vault.writes().length, writes);
    });
  } finally {
    legacy.cleanup();
  }
});
