'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const game = require('./lib/game');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Limite simples por IP para a API: 120 requisições por minuto.
function makeLimiter(max = 120, windowMs = 60000) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now();
    let h = hits.get(ip);
    if (!h || now > h.reset) {
      h = { count: 0, reset: now + windowMs };
      hits.set(ip, h);
    }
    h.count++;
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
    }
    return h.count <= max;
  };
}

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400);
    return res.end('Requisição inválida');
  }
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Acesso negado');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

function createApp(options = {}) {
  const words = options.words || game.loadWords();
  const dayOpts = {
    timeZone: options.timeZone || process.env.TZ_NAME || 'America/Sao_Paulo',
    startDate: options.startDate || process.env.START_DATE || '2026-10-19',
  };
  const now = options.now || (() => new Date());
  const limiter = makeLimiter();

  return http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');

    try {
      if (url.pathname.startsWith('/api/')) {
        if (!limiter(req.socket.remoteAddress || 'x')) {
          return sendJson(res, 429, { error: 'muitas_requisicoes' });
        }

        if (url.pathname === '/api/today' && req.method === 'GET') {
          const d = game.dayInfo(now(), dayOpts);
          return sendJson(res, 200, { ...d, len: game.LEN, max: game.MAX });
        }

        if (url.pathname === '/api/check' && req.method === 'POST') {
          const body = await readJson(req);
          const d = game.dayInfo(now(), dayOpts);
          if (body.key !== d.key) return sendJson(res, 409, { error: 'day_changed', key: d.key });
          try {
            const out = game.evaluate(words, d.n, body.guesses);
            return sendJson(res, 200, { key: d.key, n: d.n, ...out });
          } catch (e) {
            if (e instanceof game.InvalidGuesses) return sendJson(res, 400, { error: 'invalid_guesses' });
            throw e;
          }
        }

        return sendJson(res, 404, { error: 'not_found' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
      }
      return serveStatic(req, res, url.pathname);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'erro_interno' : e.message });
      else res.end();
    }
  });
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp();
  server.listen(port, host, () => {
    const d = game.dayInfo(new Date(), {
      timeZone: process.env.TZ_NAME || 'America/Sao_Paulo',
      startDate: process.env.START_DATE || '2026-10-19',
    });
    console.log(`Palavra Difícil no ar em http://localhost:${port} (palavra nº ${d.n}, ${d.key})`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
