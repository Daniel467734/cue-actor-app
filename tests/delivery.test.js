import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryFor } from '../src/delivery.js';

test('parenthetical before a line sets the tone', () => {
  const items = [{ type: 'direction', parenthetical: true, text: 'whispering' }, { type: 'dialogue', character: 'A', text: 'Stay quiet.' }];
  const d = deliveryFor(items, 1);
  assert.equal(d.tone, 'whisper');
  assert.ok(d.gain < 1);
});

test('inline parentheticals are not spoken', () => {
  const d = deliveryFor([{ type: 'dialogue', character: 'A', text: '(angrily) Get out.' }], 0);
  assert.equal(d.text, 'Get out.');
  assert.equal(d.tone, 'angry');
});

test('manual tone wins', () => {
  assert.equal(deliveryFor([{ type: 'dialogue', text: 'Hello.', tone: 'sad' }], 0).tone, 'sad');
});

import { dueLineIds, lineMemory } from '../src/stats.js';
test('spaced repetition: new and failed lines are due, fresh clean lines are not', () => {
  const items = [1, 2, 3].map((n) => ({ id: `l${n}`, type: 'dialogue', character: 'A', text: 'x' }));
  const now = Date.now();
  const sessions = [{ character: 'A', startedAt: now - 1000, endedAt: now, results: [{ lineId: 'l1', status: 'ok' }, { lineId: 'l2', status: 'missed' }] }];
  assert.deepEqual(dueLineIds(sessions, 'A', items, now), ['l2', 'l3']);
  assert.equal(lineMemory(sessions, 'A').get('l1').streak, 1);
});
