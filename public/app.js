(function () {
  "use strict";

  var LEN = 5, MAX = 6;
  var WIN_MSG = ["Inacreditável", "Impressionante", "Muito bem", "Bom trabalho", "Na reta final", "Por um fio"];
  var STORE_KEY = "palavra-dificil:v2";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function norm(s) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }

  /* Armazenamento: só guarda as tentativas do dia e as estatísticas deste navegador */
  var memory = null;
  function load() {
    try { var v = JSON.parse(localStorage.getItem(STORE_KEY)); if (v && typeof v === "object") return v; } catch (e) {}
    return memory || {};
  }
  function save() {
    memory = store;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) {}
  }
  var store = load();
  if (!store.stats) store.stats = { played: 0, wins: 0, streak: 0, best: 0, last: "", dist: [0, 0, 0, 0, 0, 0] };

  /* Servidor */
  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var err = new Error((data && data.error) || ("http " + r.status));
          err.status = r.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }
  function check(guesses) {
    return api("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: state.key, guesses: guesses })
    });
  }

  var state = {
    key: "", n: 0, label: "", endAt: 0,
    guesses: [], results: [], status: "playing", entry: null, hintClass: null, hint: false,
    cur: "", busy: false
  };
  var tiles = [], rows = [], keyEls = {}, keyState = {};
  var STATE_LABEL = { correct: "certa", present: "em outro lugar", absent: "ausente", filled: "", empty: "vazia" };

  /* Montagem */
  var boardEl = $("board");
  function buildBoard() {
    boardEl.textContent = ""; tiles = []; rows = [];
    for (var r = 0; r < MAX; r++) {
      var row = document.createElement("div"); row.className = "row";
      var line = [];
      for (var i = 0; i < LEN; i++) {
        var t = document.createElement("div"); t.className = "tile"; t.dataset.state = "empty";
        t.style.setProperty("--i", i);
        t.setAttribute("aria-label", "vazia");
        row.appendChild(t); line.push(t);
      }
      boardEl.appendChild(row); tiles.push(line); rows.push(row);
    }
  }

  var KB = ["qwertyuiop", "asdfghjkl", "*zxcvbnm#"];
  function buildKeyboard() {
    var kb = $("kb"); kb.textContent = ""; keyEls = {};
    KB.forEach(function (rowStr) {
      var row = document.createElement("div"); row.className = "kb-row";
      rowStr.split("").forEach(function (ch) {
        var b = document.createElement("button"); b.type = "button"; b.className = "key";
        if (ch === "*") { b.className += " wide"; b.textContent = "Enter"; b.dataset.k = "enter"; b.setAttribute("aria-label", "Enviar tentativa"); }
        else if (ch === "#") {
          b.className += " wide"; b.dataset.k = "back"; b.setAttribute("aria-label", "Apagar");
          b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7z"/><path d="m13 10 4 4m0-4-4 4"/></svg>';
        } else { b.textContent = ch; b.dataset.k = ch; keyEls[ch] = b; }
        row.appendChild(b);
      });
      kb.appendChild(row);
    });
  }

  /* Pintura */
  function paintTile(r, i, letter, st) {
    var t = tiles[r][i];
    t.textContent = letter ? letter.toUpperCase() : "";
    t.dataset.state = st;
    t.setAttribute("aria-label", (letter ? letter.toUpperCase() + ", " : "") + STATE_LABEL[st]);
  }
  function paintCurrent() {
    var r = state.guesses.length;
    if (r >= MAX) return;
    for (var i = 0; i < LEN; i++) {
      var ch = state.cur[i] || "";
      paintTile(r, i, ch, ch ? "filled" : "empty");
    }
  }
  function applyKeys(g, res) {
    var rank = { absent: 1, present: 2, correct: 3 };
    for (var i = 0; i < LEN; i++) {
      var ch = g[i], st = res[i];
      if (!keyState[ch] || rank[st] > rank[keyState[ch]]) keyState[ch] = st;
      if (keyEls[ch]) keyEls[ch].dataset.state = keyState[ch];
    }
  }

  /* Avisos */
  var toastTimer = null;
  function toast(msg, ms) {
    var el = $("toast"); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, ms || 1600);
  }
  function announce(msg) { $("sr").textContent = msg; }

  function updateMeta() {
    $("meta").textContent = "Nº " + state.n + " · " + state.label;
  }

  /* Dica */
  function updateHint() {
    var row = $("hint-row"); row.textContent = "";
    if (state.status !== "playing" || !state.hintClass) return;
    if (state.hint) {
      var p = document.createElement("p"); p.className = "hint-text";
      p.innerHTML = "Classe gramatical: <b></b>";
      p.querySelector("b").textContent = state.hintClass;
      row.appendChild(p);
    } else if (state.guesses.length >= 3) {
      var b = document.createElement("button"); b.type = "button"; b.className = "hint-btn";
      b.textContent = "Pedir dica: classe gramatical";
      b.addEventListener("click", function () {
        state.hint = true; store.day.hint = true; save(); updateHint();
      });
      row.appendChild(b);
    }
  }

  /* Fim de jogo */
  function showEntry() {
    var e = state.entry, tries = state.guesses.length;
    $("e-kicker").innerHTML = state.status === "won"
      ? "<b>" + WIN_MSG[tries - 1] + "</b> · acertou em " + tries + " de " + MAX
      : "<b>Não foi dessa vez</b> · a palavra era";
    $("e-word").textContent = e.word;
    $("e-class").textContent = e.class;
    $("e-def").textContent = e.definition;
    $("e-ex").textContent = e.example;
    $("entry").hidden = false;
    $("kb").hidden = true;
    $("hint-row").textContent = "";
    $("share-box").hidden = true;
    tick();
  }

  function finish(live) {
    if (live) {
      var s = store.stats, y = new Date(); y.setDate(y.getDate() - 1);
      var yKey = y.getFullYear() + "-" + pad(y.getMonth() + 1) + "-" + pad(y.getDate());
      s.played++;
      if (state.status === "won") {
        s.wins++;
        s.streak = (s.last === yKey || s.lastKey === yKey) ? s.streak + 1 : 1;
        s.best = Math.max(s.best, s.streak);
        s.dist[state.guesses.length - 1]++;
      } else { s.streak = 0; }
      s.lastKey = state.key;
      s.last = state.status === "won" ? state.key : s.last;
      save();
    }
    showEntry();
  }

  function applyServer(res) {
    state.results = res.results; state.status = res.status;
    state.entry = res.entry || null; state.hintClass = res.hint || null;
  }

  /* Revelação */
  function reveal(r, g, res, cb) {
    state.busy = true;
    var total = reduceMotion ? 0 : (LEN - 1) * 250 + 500;
    for (var i = 0; i < LEN; i++) {
      (function (i) {
        var t = tiles[r][i];
        if (reduceMotion) { paintTile(r, i, g[i], res[i]); return; }
        t.classList.add("flip");
        setTimeout(function () { paintTile(r, i, g[i], res[i]); }, i * 250 + 250);
        setTimeout(function () { t.classList.remove("flip"); }, i * 250 + 520);
      })(i);
    }
    setTimeout(function () { applyKeys(g, res); state.busy = false; cb(); }, total);
  }

  /* Entrada */
  function addLetter(ch) {
    if (state.status !== "playing" || state.busy || state.cur.length >= LEN) return;
    state.cur += ch; paintCurrent();
    var t = tiles[state.guesses.length][state.cur.length - 1];
    t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop");
  }
  function backspace() {
    if (state.status !== "playing" || state.busy || !state.cur.length) return;
    state.cur = state.cur.slice(0, -1); paintCurrent();
  }
  function submit() {
    if (state.status !== "playing" || state.busy) return;
    if (state.cur.length < LEN) {
      var row = rows[state.guesses.length];
      row.classList.remove("shake"); void row.offsetWidth; row.classList.add("shake");
      toast("Faltam letras");
      return;
    }
    var g = state.cur, r = state.guesses.length;
    state.busy = true;
    check(state.guesses.concat(g)).then(function (res) {
      state.guesses.push(g); state.cur = "";
      store.day.guesses = state.guesses.slice(); save();
      applyServer(res);
      reveal(r, g, res.results[r], function () {
        announce("Tentativa " + (r + 1) + ": " + res.results[r].map(function (s, i) { return g[i].toUpperCase() + " " + STATE_LABEL[s]; }).join(", "));
        if (res.status !== "playing") finish(true); else updateHint();
      });
    }).catch(function (e) {
      state.busy = false;
      if (e.status === 409) { toast("Nova palavra disponível"); init(); }
      else toast("Sem conexão com o servidor", 2200);
    });
  }

  $("kb").addEventListener("click", function (ev) {
    var b = ev.target.closest("button"); if (!b) return;
    var k = b.dataset.k;
    if (k === "enter") submit(); else if (k === "back") backspace(); else if (k) addLetter(k);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { closeSheets(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (document.querySelector(".sheet:not([hidden])")) return;
    if (ev.key === "Enter") { ev.preventDefault(); submit(); return; }
    if (ev.key === "Backspace") { ev.preventDefault(); backspace(); return; }
    if (ev.key.length === 1) {
      var ch = norm(ev.key);
      if (/^[a-z]$/.test(ch)) addLetter(ch);
    }
  });

  /* Painéis */
  var lastFocus = null;
  function openSheet(id) {
    closeSheets();
    lastFocus = document.activeElement;
    var s = $(id); s.hidden = false;
    var c = s.querySelector("[data-close]"); if (c) c.focus();
  }
  function closeSheets() {
    var open = document.querySelectorAll(".sheet:not([hidden])");
    for (var i = 0; i < open.length; i++) open[i].hidden = true;
    if (open.length && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  }
  document.querySelectorAll(".sheet").forEach(function (s) {
    s.addEventListener("click", function (ev) {
      if (ev.target === s || ev.target.closest("[data-close]")) closeSheets();
    });
  });
  $("btn-help").addEventListener("click", function () { openSheet("sheet-help"); });

  function openStats() {
    var s = store.stats, grid = $("stat-grid"), dist = $("dist");
    var pct = s.played ? Math.round(100 * s.wins / s.played) : 0;
    grid.textContent = "";
    [[s.played, "Jogos"], [pct + "%", "Vitórias"], [s.streak, "Sequência"], [s.best, "Melhor"]].forEach(function (x) {
      var c = document.createElement("div");
      var n = document.createElement("div"); n.className = "stat-num"; n.textContent = x[0];
      var l = document.createElement("div"); l.className = "stat-lab"; l.textContent = x[1];
      c.appendChild(n); c.appendChild(l); grid.appendChild(c);
    });
    dist.textContent = "";
    var max = Math.max.apply(null, s.dist.concat([1]));
    var hitRow = state.status === "won" ? state.guesses.length - 1 : -1;
    s.dist.forEach(function (v, i) {
      var row = document.createElement("div"); row.className = "dist-row";
      var lab = document.createElement("span"); lab.textContent = i + 1;
      var bar = document.createElement("div"); bar.className = "dist-bar" + (i === hitRow ? " hit" : "");
      bar.style.width = Math.max(8, Math.round(100 * v / max)) + "%"; bar.textContent = v;
      row.appendChild(lab); row.appendChild(bar); dist.appendChild(row);
    });
    openSheet("sheet-stats");
  }
  $("btn-stats").addEventListener("click", openStats);
  $("btn-stats2").addEventListener("click", openStats);

  /* Compartilhar */
  function shareText() {
    var head = "Palavra Difícil nº " + state.n + " " + (state.status === "won" ? state.guesses.length : "X") + "/" + MAX;
    var icon = { correct: "🟩", present: "🟨", absent: "⬛" };
    var lines = state.results.map(function (res) {
      return res.map(function (s) { return icon[s]; }).join("");
    });
    return head + "\n\n" + lines.join("\n");
  }
  $("btn-share").addEventListener("click", function () {
    var text = shareText(), box = $("share-box");
    function fallback() {
      box.value = text; box.hidden = false; box.focus(); box.select();
      toast("Selecione e copie o resultado", 2200);
    }
    try {
      navigator.clipboard.writeText(text).then(function () { toast("Resultado copiado"); }, fallback);
    } catch (e) { fallback(); }
  });

  /* Contagem regressiva até a meia-noite do servidor */
  var reloading = false;
  function tick() {
    if (!state.endAt) return;
    var s = Math.max(0, Math.floor((state.endAt - Date.now()) / 1000));
    $("countdown").textContent = pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60);
    if (s === 0 && !reloading) {
      reloading = true;
      init().then(function () { reloading = false; }, function () { reloading = false; });
    }
  }
  setInterval(tick, 1000);

  /* Erro de carregamento */
  function showLoadError() {
    var row = $("hint-row"); row.textContent = "";
    var b = document.createElement("button"); b.type = "button"; b.className = "hint-btn";
    b.textContent = "Não foi possível carregar o jogo. Tentar de novo";
    b.addEventListener("click", init);
    row.appendChild(b);
  }

  /* Início */
  function init() {
    return api("/api/today").then(function (info) {
      state.key = info.key; state.n = info.n; state.label = info.label;
      state.endAt = Date.now() + info.secondsLeft * 1000;
      if (!store.day || store.day.key !== state.key) store.day = { key: state.key, guesses: [], hint: false };
      state.guesses = (store.day.guesses || []).filter(function (g) { return typeof g === "string" && g.length === LEN; });
      state.hint = !!store.day.hint;
      state.cur = ""; state.results = []; state.status = "playing"; state.entry = null; state.hintClass = null; state.busy = false;
      keyState = {};
      buildBoard(); buildKeyboard();
      $("entry").hidden = true; $("kb").hidden = false; $("hint-row").textContent = "";
      updateMeta();
      if (!state.guesses.length) { paintCurrent(); return; }
      return check(state.guesses).then(applyServer, function (e) {
        if (e.status === 400) { state.guesses = []; store.day.guesses = []; save(); return; }
        throw e;
      }).then(function () {
        state.guesses.forEach(function (g, r) {
          var res = state.results[r];
          for (var i = 0; i < LEN; i++) paintTile(r, i, g[i], res[i]);
          applyKeys(g, res);
        });
        if (state.status !== "playing") finish(false);
        else { paintCurrent(); updateHint(); }
      });
    }).catch(function () { showLoadError(); });
  }
  init();
})();
