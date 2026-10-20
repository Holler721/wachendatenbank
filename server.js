'use strict';
/*
 * Jedi Shadow Network: Server
 * Keine externen Pakete. Läuft mit Node.js 18 oder neuer.
 *   node server.js                 startet den Server
 *   node server.js --hash "pw"     erzeugt einen Passwort-Hash für owner.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const INDEX_FILE = path.join(__dirname, 'public', 'index.html');
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'sh_sess';

const ROLES = { viewer: 1, agent: 2, editor: 3, owner: 4 };
const STATES = ['Verbündet', 'Dunkel', 'Unklar'];
const RANKS = ['Schatten-Meister', 'Schatten', 'Adjutant', 'Informant', 'Zielperson'];

/* ---------- Passwörter ---------- */
const SCRYPT = { N: 16384, r: 8, p: 1 };
function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, 64, SCRYPT);
  return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex');
}
function checkPw(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 3 || p[0] !== 'scrypt') return false;
  const expected = Buffer.from(p[2], 'hex');
  const h = crypto.scryptSync(String(pw), Buffer.from(p[1], 'hex'), expected.length, SCRYPT);
  return h.length === expected.length && crypto.timingSafeEqual(h, expected);
}

if (process.argv[2] === '--hash') {
  if (!process.argv[3]) { console.error('Verwendung: node server.js --hash "DeinPasswort"'); process.exit(1); }
  console.log(hashPw(process.argv[3]));
  process.exit(0);
}

/* ---------- Datenhaltung (eine JSON-Datei) ---------- */
let db;
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('Speichern fehlgeschlagen:', e.message);
  }
}
function ensureOwner() {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'owner.json'), 'utf8'));
  const name = String(process.env.OWNER_USER || cfg.username).toLowerCase();
  const u = db.users[name];
  if (!u) {
    db.users[name] = {
      name, role: 'owner', created: new Date().toISOString(), since: Date.now(),
      hash: process.env.OWNER_PASSWORD ? hashPw(process.env.OWNER_PASSWORD) : cfg.hash
    };
  } else {
    u.role = 'owner';
    if (process.env.OWNER_PASSWORD && !checkPw(process.env.OWNER_PASSWORD, u.hash)) {
      u.hash = hashPw(process.env.OWNER_PASSWORD);
      u.since = Date.now();
    }
  }
  Object.keys(db.users).forEach(function (k) { if (k !== name && db.users[k].role === 'owner') db.users[k].role = 'editor'; });
}
function load() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { db = null; }
  if (!db) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
    db = { rev: 1, persons: {}, map: seed.map, users: {}, secret: crypto.randomBytes(32).toString('hex') };
    seed.persons.forEach(function (p, i) {
      db.persons['p' + String(i + 1).padStart(2, '0')] = Object.assign({}, p, { watch: false, ts: i + 1 });
    });
  }
  db.users = db.users || {};
  if (process.env.SESSION_SECRET) db.secret = process.env.SESSION_SECRET;
  if (!db.secret) db.secret = crypto.randomBytes(32).toString('hex');
  ensureOwner();
  save();
}
function bump() { db.rev++; save(); }

/* ---------- Sitzungen (signierter Cookie) ---------- */
const b64 = function (s) { return Buffer.from(s).toString('base64url'); };
function sign(data) { return crypto.createHmac('sha256', db.secret).update(data).digest('base64url'); }
function makeToken(name) {
  const body = b64(JSON.stringify({ u: name, iat: Date.now(), exp: Date.now() + SESSION_MS }));
  return body + '.' + sign(body);
}
function sessionUser(req) {
  const m = /(?:^|;\s*)sh_sess=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 2) return null;
  const good = sign(parts[0]);
  const a = Buffer.from(parts[1]), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let t;
  try { t = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!t || t.exp < Date.now()) return null;
  const u = db.users[t.u];
  if (!u || t.iat < (u.since || 0)) return null;
  return u;
}
function isHttps(req) {
  return !!req.socket.encrypted || (TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}
function setCookie(res, req, value, maxAge) {
  res.setHeader('Set-Cookie', COOKIE + '=' + value + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (isHttps(req) ? '; Secure' : ''));
}

/* ---------- Begrenzung falscher Anmeldungen ---------- */
const fails = new Map();
function clientIp(req) {
  if (TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'x';
}
function limited(key, max) {
  const e = fails.get(key);
  if (!e) return false;
  if (Date.now() - e.t > 15 * 60 * 1000) { fails.delete(key); return false; }
  return e.n >= max;
}
function fail(key) {
  const e = fails.get(key);
  if (!e || Date.now() - e.t > 15 * 60 * 1000) fails.set(key, { n: 1, t: Date.now() });
  else e.n++;
}
setInterval(function () {
  const now = Date.now();
  fails.forEach(function (v, k) { if (now - v.t > 15 * 60 * 1000) fails.delete(k); });
}, 5 * 60 * 1000).unref();

/* ---------- Prüfung der Eingaben ---------- */
function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function today() { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; }
function cleanPerson(b, partial) {
  const o = {};
  const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
  if (!b || typeof b !== 'object') bad('Ungültige Daten.');
  if ('n' in b || !partial) { o.n = str(b.n, 60); if (!o.n) bad('Name fehlt.'); }
  if ('r' in b || !partial) { if (RANKS.indexOf(b.r) < 0) bad('Ungültiger Rang.'); o.r = b.r; }
  if ('s' in b || !partial) { if (STATES.indexOf(b.s) < 0) bad('Ungültiger Status.'); o.s = b.s; }
  if ('p' in b || !partial) { const p = Number(b.p); if (!isFinite(p)) bad('Ungültiges Machtlevel.'); o.p = Math.max(0, Math.min(100, Math.round(p))); }
  if ('l' in b || !partial) { o.l = str(b.l, 40) || 'Unbekannt'; }
  if ('note' in b || !partial) { o.note = str(b.note, 300) || 'Keine Notiz.'; }
  if ('seen' in b || !partial) { o.seen = /^\d{2}\.\d{2}\.$/.test(b.seen) ? b.seen : today(); }
  if ('watch' in b || !partial) { o.watch = !!b.watch; }
  return o;
}
function cleanMap(b) {
  const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
  if (!b || !Array.isArray(b.nodes) || !Array.isArray(b.edges)) bad('Ungültige Karte.');
  if (b.nodes.length > 60) bad('Maximal 60 Systeme.');
  if (b.edges.length > 400) bad('Zu viele Routen.');
  const keys = {};
  const nodes = b.nodes.map(function (n) {
    if (!n || typeof n.k !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(n.k) || keys[n.k]) bad('Ungültiges System.');
    keys[n.k] = 1;
    const x = Number(n.x), y = Number(n.y);
    if (!isFinite(x) || !isFinite(y)) bad('Ungültige Position.');
    const id = str(n.id, 40);
    if (!id) bad('Jedes System braucht einen Namen.');
    if (STATES.indexOf(n.s) < 0) bad('Ungültiger Status.');
    return { k: n.k, id: id, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), s: n.s, i: str(n.i, 300) };
  });
  const seen = {}, edges = [];
  b.edges.forEach(function (e) {
    if (!Array.isArray(e) || e.length !== 2 || !keys[e[0]] || !keys[e[1]] || e[0] === e[1]) return;
    const id = [e[0], e[1]].sort().join('|');
    if (seen[id]) return;
    seen[id] = 1;
    edges.push([e[0], e[1]]);
  });
  return { nodes: nodes, edges: edges, rev: Date.now() };
}

/* ---------- HTTP ---------- */
function headers(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 100 * 1024) { const e = new Error('Anfrage zu groß.'); e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { const err = new Error('Ungültiges JSON.'); err.status = 400; reject(err); }
    });
    req.on('error', reject);
  });
}
function need(req, role) {
  const u = sessionUser(req);
  if (!u) { const e = new Error('Bitte melde dich an.'); e.status = 401; throw e; }
  if (ROLES[u.role] < ROLES[role]) { const e = new Error('Dafür fehlen dir die Rechte.'); e.status = 403; throw e; }
  return u;
}
function publicUser(u) { return { name: u.name, role: u.role }; }
function newId() { return crypto.randomBytes(6).toString('hex'); }
function validPassword(p) {
  if (typeof p !== 'string' || p.length < 10 || p.length > 200) { const e = new Error('Das Passwort braucht mindestens 10 Zeichen.'); e.status = 400; throw e; }
}

async function api(req, res, url) {
  const method = req.method, p = url.pathname;
  if (method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'shadow-net' || !/^application\/json/.test(req.headers['content-type'] || (method === 'DELETE' ? 'application/json' : ''))) {
      return send(res, 400, { error: 'Ungültige Anfrage.' });
    }
  }
  if (p === '/api/session' && method === 'GET') {
    const u = sessionUser(req);
    return send(res, 200, { user: u ? publicUser(u) : null });
  }
  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const ip = clientIp(req), name = str(b.username, 40).toLowerCase();
    if (limited('ip:' + ip, 8) || limited('u:' + name, 30)) return send(res, 429, { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' });
    const u = db.users[name];
    const ok = u ? checkPw(String(b.password || ''), u.hash) : (checkPw('x', 'scrypt$00$00'), false);
    if (!ok) { fail('ip:' + ip); fail('u:' + name); return send(res, 401, { error: 'Benutzername oder Passwort stimmt nicht.' }); }
    fails.delete('ip:' + ip); fails.delete('u:' + name);
    setCookie(res, req, makeToken(u.name), Math.floor(SESSION_MS / 1000));
    return send(res, 200, { user: publicUser(u) });
  }
  if (p === '/api/logout' && method === 'POST') {
    setCookie(res, req, '', 0);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/data' && method === 'GET') {
    need(req, 'viewer');
    const since = Number(url.searchParams.get('since'));
    if (since === db.rev) return send(res, 200, { same: true, rev: db.rev });
    const persons = Object.keys(db.persons).map(function (id) { return Object.assign({ id: id }, db.persons[id]); })
      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    return send(res, 200, { rev: db.rev, persons: persons, map: db.map });
  }
  if (p === '/api/persons' && method === 'POST') {
    need(req, 'agent');
    if (Object.keys(db.persons).length >= 2000) return send(res, 400, { error: 'Das Register ist voll.' });
    const o = cleanPerson(await readBody(req), false);
    o.ts = Date.now();
    const id = newId();
    db.persons[id] = o; bump();
    return send(res, 200, { id: id });
  }
  let m = /^\/api\/persons\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (m) {
    need(req, 'agent');
    const cur = db.persons[m[1]];
    if (!cur) return send(res, 404, { error: 'Akte nicht gefunden.' });
    if (method === 'PATCH') {
      const o = cleanPerson(await readBody(req), true);
      Object.assign(cur, o); bump();
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') { delete db.persons[m[1]]; bump(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/map' && method === 'PUT') {
    need(req, 'editor');
    db.map = cleanMap(await readBody(req)); bump();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && method === 'POST') {
    const u = need(req, 'viewer');
    const b = await readBody(req);
    if (!checkPw(String(b.current || ''), u.hash)) return send(res, 400, { error: 'Das aktuelle Passwort stimmt nicht.' });
    validPassword(b.next);
    u.hash = hashPw(b.next); u.since = Date.now(); save();
    setCookie(res, req, makeToken(u.name), Math.floor(SESSION_MS / 1000));
    return send(res, 200, { ok: true });
  }
  if (p === '/api/users' && method === 'GET') {
    need(req, 'owner');
    return send(res, 200, { users: Object.keys(db.users).map(function (k) { const u = db.users[k]; return { name: u.name, role: u.role, created: u.created }; }) });
  }
  if (p === '/api/users' && method === 'POST') {
    need(req, 'owner');
    const b = await readBody(req);
    const name = str(b.username, 24).toLowerCase();
    if (!/^[a-z0-9._-]{3,24}$/.test(name)) return send(res, 400, { error: 'Benutzername: 3 bis 24 Zeichen aus a-z, 0-9, Punkt, Strich.' });
    if (db.users[name]) return send(res, 400, { error: 'Diesen Benutzernamen gibt es schon.' });
    if (['viewer', 'agent', 'editor'].indexOf(b.role) < 0) return send(res, 400, { error: 'Ungültige Rolle.' });
    validPassword(b.password);
    db.users[name] = { name: name, role: b.role, hash: hashPw(b.password), created: new Date().toISOString(), since: Date.now() };
    save();
    return send(res, 200, { ok: true });
  }
  m = /^\/api\/users\/([a-z0-9._-]{3,24})$/.exec(p);
  if (m) {
    need(req, 'owner');
    const u = db.users[m[1]];
    if (!u) return send(res, 404, { error: 'Konto nicht gefunden.' });
    if (u.role === 'owner') return send(res, 400, { error: 'Das Owner-Konto kann hier nicht geändert werden.' });
    if (method === 'PATCH') {
      const b = await readBody(req);
      if ('role' in b) { if (['viewer', 'agent', 'editor'].indexOf(b.role) < 0) return send(res, 400, { error: 'Ungültige Rolle.' }); u.role = b.role; }
      if ('password' in b) { validPassword(b.password); u.hash = hashPw(b.password); u.since = Date.now(); }
      save();
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') { delete db.users[m[1]]; save(); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'Nicht gefunden.' });
}

const server = http.createServer(function (req, res) {
  headers(res);
  const url = new URL(req.url, 'http://x');
  if (url.pathname.indexOf('/api/') === 0) {
    api(req, res, url).catch(function (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Serverfehler.' });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    fs.readFile(INDEX_FILE, function (err, buf) {
      if (err) { res.writeHead(500); return res.end('index.html fehlt'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : buf);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Nicht gefunden');
});

load();
server.listen(PORT, '0.0.0.0', function () {
  console.log('Jedi Shadow Network läuft auf Port ' + PORT + ' (Daten: ' + DATA_DIR + ')');
});
