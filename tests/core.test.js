import test from 'node:test';
import assert from 'node:assert/strict';
import { matchLine, detectCommand, hintFrom, tokenize } from '../src/matcher.js';
import { parseScriptText, listCharacters } from '../src/parser.js';

test('exact line completes', () => {
  const m = matchLine("I don't know what you mean.", 'i dont know what you mean');
  assert.equal(m.complete, true);
  assert.equal(m.score, 1);
});

test('missing words flagged and hint continues from the stall point', () => {
  const line = 'We should leave before the storm gets any worse tonight';
  const m = matchLine(line, 'we should leave before', 2);
  assert.equal(m.complete, false);
  assert.equal(hintFrom(line, m), 'the storm gets');
});

test('relaxed accepts a close paraphrase, strict does not', () => {
  const line = 'I never wanted any of this to happen to you';
  const said = 'I never wanted this to happen to you';
  assert.equal(matchLine(line, said, 1).complete, true);
  assert.equal(matchLine(line, said, 3).complete, false);
});

test('fuzzy recognition errors tolerated at normal strictness', () => {
  assert.equal(matchLine('The weather is dreadful', 'the whether is dreadful', 2).complete, true);
});

test('ignores parentheticals in expected text', () => {
  assert.deepEqual(tokenize('(angrily) Get out [exits]'), ['get', 'out']);
});

test('voice commands', () => {
  assert.equal(detectCommand('I need a prompt'), 'prompt');
  assert.equal(detectCommand('Prompt please'), 'prompt');
  assert.equal(detectCommand('line'), 'prompt');
  assert.equal(detectCommand('skip'), 'skip');
  assert.equal(detectCommand('go back'), 'back');
  assert.equal(detectCommand('say that again'), 'repeat');
  assert.equal(detectCommand('to be or not to be that is the question'), null);
});

test('parses stage play format', () => {
  const { items, format } = parseScriptText(`HAMLET: To be or not to be.
OPHELIA: (softly) My lord, how does your honour?
It has been many days.
HAMLET: Well, I thank you.
OPHELIA: Good.`);
  assert.equal(format, 'stage');
  const d = items.filter((i) => i.type === 'dialogue');
  assert.equal(d.length, 4);
  assert.equal(d[1].text, 'My lord, how does your honour? It has been many days.');
  assert.equal(listCharacters(items)[0].name, 'HAMLET');
});

test('parses screenplay format', () => {
  const { items, format } = parseScriptText(`INT. KITCHEN - NIGHT

Rain hammers the window.

JOHN
(whispering)
Did you hear that?

MARY (V.O.)
Hear what?
Nothing at all.

JOHN
Never mind.`);
  assert.equal(format, 'screenplay');
  assert.equal(items[0].type, 'scene');
  const d = items.filter((i) => i.type === 'dialogue');
  assert.deepEqual(d.map((x) => x.character), ['JOHN', 'MARY', 'JOHN']);
  assert.equal(d[1].text, 'Hear what? Nothing at all.');
});
