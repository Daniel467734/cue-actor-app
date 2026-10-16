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
