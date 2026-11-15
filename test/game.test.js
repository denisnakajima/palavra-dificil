'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../lib/game');
const { createApp } = require('../server');

const WORDS = [
  { w: 'âmago', c: 'substantivo masculino', d: 'Parte mais íntima.', e: 'Exemplo um.' },
  { w: 'sanha', c: 'substantivo feminino', d: 'Fúria.', e: 'Exemplo dois.' },
  { w: 'ufano', c: 'adjetivo', d: 'Orgulhoso.', e: 'Exemplo três.' },
];

test('normalize remove acentos e cedilha', () => {
  assert.equal(game.normalize('Âmago'), 'amago');
  assert.equal(game.normalize('quiçá'), 'quica');
});

test('words.json é válido: 5 letras, sem repetidas, campos completos', () => {
  const list = game.loadWords();
  assert.ok(list.length >= 50);
});

test('score: verde, amarelo e cinza', () => {
  assert.deepEqual(game.score('sanha', 'sanha'), ['correct', 'correct', 'correct', 'correct', 'correct']);
  assert.deepEqual(game.score('arara', 'amago'), ['correct', 'absent', 'correct', 'absent', 'absent']);
});

test('score: letras repetidas não ganham amarelo a mais', () => {
  assert.deepEqual(game.score('ooooa', 'alvoo'), ['present', 'absent', 'absent', 'correct', 'present']);
});

test('dayInfo: virada à meia-noite de São Paulo', () => {
  const a = game.dayInfo(new Date('2026-10-19T21:00:00Z'));
  assert.equal(a.key, '2026-10-19');
  assert.equal(a.n, 1);
  assert.equal(a.secondsLeft, 6 * 3600);
  const b = game.dayInfo(new Date('2026-10-20T02:59:59Z'));
  assert.equal(b.key, '2026-10-19');
  assert.equal(b.secondsLeft, 1);
  const c = game.dayInfo(new Date('2026-10-20T03:00:00Z'));
  assert.equal(c.key, '2026-10-20');
  assert.equal(c.n, 2);
});

test('entryFor dá a volta na lista', () => {
  assert.equal(game.entryFor(WORDS, 1).w, 'âmago');
  assert.equal(game.entryFor(WORDS, 3).w, 'ufano');
  assert.equal(game.entryFor(WORDS, 4).w, 'âmago');
});

test('evaluate: não revela a palavra enquanto a partida está aberta', () => {
  const out = game.evaluate(WORDS, 1, ['sanha', 'ufano']);
  assert.equal(out.status, 'playing');
  assert.equal(out.entry, undefined);
  assert.equal(out.hint, undefined);
});

test('evaluate: dica só depois da terceira tentativa', () => {
  const out = game.evaluate(WORDS, 1, ['sanha', 'ufano', 'ocaso'.slice(0, 5)]);
  assert.equal(out.hint, 'substantivo masculino');
  assert.equal(out.entry, undefined);
});

test('evaluate: acerto revela o verbete', () => {
  const out = game.evaluate(WORDS, 1, ['sanha', 'amago']);
  assert.equal(out.status, 'won');
  assert.equal(out.entry.word, 'âmago');
  assert.equal(out.entry.example, 'Exemplo um.');
});

test('evaluate: seis erros revelam o verbete', () => {
  const out = game.evaluate(WORDS, 1, ['sanha', 'ufano', 'abcde', 'abcde', 'abcde', 'abcde']);
  assert.equal(out.status, 'lost');
  assert.equal(out.entry.word, 'âmago');
});

test('evaluate: rejeita entradas inválidas', () => {
  const bad = [
    'nope',
    [1],
    ['curta'.slice(0, 4)],
    ['12345'],
    ['amago', 'sanha'],
    new Array(7).fill('sanha'),
  ];
  for (const g of bad) assert.throws(() => game.evaluate(WORDS, 1, g), game.InvalidGuesses);
});

test('API: /api/today, /api/check e arquivos estáticos', async () => {
  const fixed = new Date('2026-10-19T21:00:00Z');
  const server = createApp({ words: WORDS, now: () => fixed });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const today = await (await fetch(base + '/api/today')).json();
    assert.equal(today.key, '2026-10-19');
    assert.equal(today.n, 1);
    assert.equal(JSON.stringify(today).includes('amago'), false);

    const post = (body) =>
      fetch(base + '/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    let r = await post({ key: today.key, guesses: ['sanha'] });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.status, 'playing');
    assert.equal(JSON.stringify(j).includes('âmago'), false);

    r = await post({ key: today.key, guesses: ['âmago'] });
    assert.equal((await r.json()).status, 'won');

    r = await post({ key: '2026-10-18', guesses: [] });
    assert.equal(r.status, 409);

    r = await post({ key: today.key, guesses: ['abc'] });
    assert.equal(r.status, 400);

    r = await fetch(base + '/');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.ok(r.headers.get('content-security-policy'));

    r = await fetch(base + '/app.js');
    assert.equal(r.status, 200);

    r = await fetch(base + '/nao-existe.js');
    assert.equal(r.status, 404);

    // tentativa de sair da pasta public
    const raw = await new Promise((resolve) => {
      const net = require('node:net');
      const s = net.connect(server.address().port, '127.0.0.1', () => {
        s.write('GET /../server.js HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
      });
      let data = '';
      s.on('data', (d) => (data += d));
      s.on('end', () => resolve(data));
    });
    assert.match(raw.split('\r\n')[0], / (403|404) /);
    assert.equal(raw.includes("require('node:http')"), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
