import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractFirstLoreEntry, resolveRefDir, safeTopicPath } from './reference.js';

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ack-web-ref-'));
}

test('safeTopicPath rejects traversal and missing files', () => {
  const dir = makeTempDir();
  assert.equal(safeTopicPath(dir, ''), null);
  assert.equal(safeTopicPath(dir, '../../etc/passwd'), null);
  assert.equal(safeTopicPath(dir, 'missing'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('safeTopicPath resolves valid files', () => {
  const dir = makeTempDir();
  const file = path.join(dir, 'fire');
  fs.writeFileSync(file, 'content');
  assert.equal(safeTopicPath(dir, '/fire/'), path.resolve(file));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('extractFirstLoreEntry returns first lore block', () => {
  const content = 'keywords fire\n---\nThis is the first entry.\n---\nflags city\n---\nCity entry.';
  assert.equal(extractFirstLoreEntry(content), 'This is the first entry.');
});

test('resolveRefDir maps known types', () => {
  assert.equal(resolveRefDir('help', 'H', 'S', 'L'), 'H');
  assert.equal(resolveRefDir('shelp', 'H', 'S', 'L'), 'S');
  assert.equal(resolveRefDir('lore', 'H', 'S', 'L'), 'L');
});
