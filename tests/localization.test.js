"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { TEXT, strings, describeError } = require('../src/native-chat/messages');
const { rows, translateUi } = require('../src/ui-translations');

function leaves(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? leaves(value, path) : [[path, value]];
  });
}

for (const locale of ['ja', 'ko']) {
  test(`${locale}: complete chat/settings/error translations preserve interpolation tokens`, () => {
    const source = new Map(leaves(TEXT.en));
    const translated = new Map(leaves(TEXT[locale]));
    assert.deepEqual([...translated.keys()].sort(), [...source.keys()].sort());
    for (const [key, value] of source) {
      const target = translated.get(key);
      if (value === null) { assert.equal(target, null); continue; }
      assert.equal(typeof target, 'string', key);
      assert.ok(target.trim(), key);
      assert.deepEqual(target.match(/\{\w+\}/g), value.match(/\{\w+\}/g), key);
    }
    for (const code of Object.keys(TEXT.en.errors)) {
      const result = describeError({ code }, locale);
      assert.ok(result.text);
      assert.notEqual(result.text, describeError({ code }, 'en').text, code);
    }
    assert.equal(describeError({ code: 'http-error', status: 402 }, locale).text, TEXT[locale].errors['insufficient-balance']);
  });

  test(`${locale}: shared labels are complete and unknown diagnostic text is preserved`, () => {
    assert.equal(new Set(rows.map(row => row[0])).size, rows.length);
    for (const row of rows) {
      assert.equal(row.length, 4);
      assert.ok(translateUi(row[0], locale).trim());
    }
    assert.equal(translateUi('Custom disk error: EACCES', locale), 'Custom disk error: EACCES');
    assert.equal(strings('unsupported'), TEXT.en);
  });
}
