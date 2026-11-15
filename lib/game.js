'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEN = 5;
const MAX = 6;
const DEFAULT_TZ = 'America/Sao_Paulo';
const DEFAULT_START = '2026-10-19'; // palavra nº 1

function normalize(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

function loadWords(file = path.join(__dirname, '..', 'words.json')) {
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list) || list.length === 0) throw new Error('words.json está vazio');
  const seen = new Set();
  for (const e of list) {
    const k = normalize(e.w || '');
    if (!/^[a-z]{5}$/.test(k)) throw new Error(`Palavra inválida (precisa ter 5 letras): ${e.w}`);
    if (seen.has(k)) throw new Error(`Palavra repetida: ${e.w}`);
    seen.add(k);
    for (const f of ['c', 'd', 'e']) {
      if (!e[f]) throw new Error(`Campo "${f}" faltando em "${e.w}"`);
    }
  }
  return list;
}

// Verde (correct), amarelo (present), cinza (absent), tratando letras repetidas.
function score(guess, answer) {
  const res = new Array(LEN).fill('absent');
  const left = {};
  for (let i = 0; i < LEN; i++) {
    if (guess[i] === answer[i]) res[i] = 'correct';
    else left[answer[i]] = (left[answer[i]] || 0) + 1;
  }
  for (let i = 0; i < LEN; i++) {
    if (res[i] === 'correct') continue;
    if (left[guess[i]] > 0) {
      res[i] = 'present';
      left[guess[i]]--;
    }
  }
  return res;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour, minute: +o.minute, second: +o.second };
}

// A virada do dia acontece à meia-noite do fuso configurado, igual para todo mundo.
function dayInfo(now = new Date(), { timeZone = DEFAULT_TZ, startDate = DEFAULT_START } = {}) {
  const p = zonedParts(now, timeZone);
  const key = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const n = Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(sy, sm - 1, sd)) / 864e5) + 1;
  const secondsLeft = 86400 - (p.hour * 3600 + p.minute * 60 + p.second);
  const label = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return { key, n, secondsLeft, label };
}

function entryFor(words, n) {
  const i = (((n - 1) % words.length) + words.length) % words.length;
  return words[i];
}

class InvalidGuesses extends Error {}

// Corrige a lista de tentativas do dia. A palavra só aparece quando a partida acaba.
function evaluate(words, n, guesses) {
  if (!Array.isArray(guesses) || guesses.length > MAX) throw new InvalidGuesses('tentativas inválidas');
  const entry = entryFor(words, n);
  const answer = normalize(entry.w);
  const results = [];
  let won = false;
  for (const raw of guesses) {
    if (won) throw new InvalidGuesses('tentativas depois do acerto');
    if (typeof raw !== 'string') throw new InvalidGuesses('tentativa inválida');
    const g = normalize(raw);
    if (!/^[a-z]{5}$/.test(g)) throw new InvalidGuesses('tentativa inválida');
    results.push(score(g, answer));
    if (g === answer) won = true;
  }
  const status = won ? 'won' : guesses.length >= MAX ? 'lost' : 'playing';
  const out = { results, status };
  if (status === 'playing' && guesses.length >= 3) out.hint = entry.c;
  if (status !== 'playing') {
    out.entry = { word: entry.w, class: entry.c, definition: entry.d, example: entry.e };
  }
  return out;
}

module.exports = { LEN, MAX, normalize, loadWords, score, dayInfo, entryFor, evaluate, InvalidGuesses };
