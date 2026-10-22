'use strict';
/*
 * Wächter Datenbank: Server
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
// Einzelrechte, pro Gruppe auf der Website (Konto -> Gruppen und Rechte) vergebbar
const PERMS = ['persons', 'files', 'reports', 'opsStart', 'opsManage', 'map', 'others', 'config', 'lockdown', 'open', 'intern', 'secret', 'logs', 'accounts', 'groups', 'ris'];
const ALLP = {}; PERMS.forEach(function (x) { ALLP[x] = true; });
const PERM_LBL = { persons: 'Personen', files: 'Akten', reports: 'Berichte', opsStart: 'Op. starten', opsManage: 'Op. steuern', map: 'Karte', others: 'Fremde Inhalte', config: 'Anpassung', lockdown: 'Notfall', open: 'Offen lesen', intern: 'Intern lesen', secret: 'Vertraulich lesen', logs: 'Logs', accounts: 'Konten', groups: 'Gruppen', ris: 'RIS Kooperation' };
const WRITE_PERMS = ['persons', 'files', 'reports', 'opsStart'];            // früher „Schreiben“
const MANAGE_PERMS = ['opsManage', 'map', 'others', 'config', 'lockdown'];  // früher „Verwalten“
const RANK_MAX = 10, RANK_OWNER = 11, BUILTIN_RANK = { viewer: 1, agent: 2, editor: 3, owner: RANK_OWNER };
function cleanRank(x, def) { const n = Math.round(Number(x)); return isFinite(n) && n >= 1 && n <= RANK_MAX ? n : def; }
const BUILTIN = {
  viewer: { label: 'Schatten', perms: { open: true } },
  agent: { label: 'Phantom', perms: { persons: true, files: true, reports: true, opsStart: true, open: true, intern: true } },
  editor: { label: 'Spektral Rat', perms: { persons: true, files: true, reports: true, opsStart: true, opsManage: true, map: true, others: true, config: true, lockdown: true, open: true, intern: true, secret: true } },
  owner: { label: 'Schatten Leitung', perms: ALLP }
};
function upgradePerms(pm) { // Gespeicherte Rechte älterer Versionen (write/manage) umstellen
  if (!pm || typeof pm !== 'object' || Array.isArray(pm)) return pm;
  if (('write' in pm || 'manage' in pm) && !('persons' in pm)) {
    const o = Object.assign({}, pm);
    WRITE_PERMS.forEach(function (x) { o[x] = !!pm.write; });
    MANAGE_PERMS.forEach(function (x) { o[x] = !!pm.manage; });
    o.logs = false;
    pm = o;
  }
  if (!('open' in pm)) { pm = Object.assign({}, pm, { open: true }); } // „Offen lesen“ war früher für alle erlaubt
  return pm;
}
/* ---------- Protokoll: wer hat wann was gemacht ---------- */
const LOG_MAX = 3000;
function logAct(u, a, t) {
  if (!Array.isArray(db.logs)) db.logs = [];
  db.logs.push({ ts: Date.now(), u: u ? u.name : '', n: u ? (u.display || u.name) : '', sid: u ? (u.sid || '') : '', a: String(a).slice(0, 80), t: String(t || '').slice(0, 300) });
  if (db.logs.length > LOG_MAX) db.logs.splice(0, db.logs.length - LOG_MAX);
}
const COLORS = ['cyan', 'red', 'amber', 'vio', 'darkred', 'orange', 'yellow', 'green', 'darkgreen', 'lightblue', 'blue', 'darkblue', 'purple', 'pink', 'white'];
const DEFAULT_CONFIG = {
  ranks: ['Schatten-Meister', 'Schatten', 'Adjutant', 'Informant', 'Zielperson'],
  states: [
    { name: 'Republik', color: 'cyan', threat: false },
    { name: 'KUS', color: 'red', threat: true },
    { name: 'Neutral', color: 'amber', threat: false },
    { name: 'Dunkle Machtpräsenz', color: 'vio', threat: true }
  ],
  rtypes: ['Report', 'Order', 'Dokument']
};
const OLD_STATES = { 'Verbündet': 'Republik', 'Dunkel': 'KUS', 'Unklar': 'Neutral' };
function rolePerms(u) { if (!u) return {}; if (u.role === 'owner') return ALLP; const r = db.roles[u.role]; return (r && r.perms) || {}; }
/* Konten- und Gruppenverwaltung ohne Schatten Leitung: nur innerhalb der eigenen Rechte (keine Rechte-Erhöhung) */
function rankOf(key) { const r = db.roles[key]; return r ? (r.rank || 1) : 0; }
function permsSubset(pm, mine) { return PERMS.every(function (x) { return !pm || !pm[x] || !!mine[x]; }); }
function canAssign(me, key) {
  const r = db.roles[key]; if (!r) return false;
  if (key === 'owner') return me.name === MAIN;
  return me.role === 'owner' || (rankOf(key) < rankOf(me.role) && permsSubset(r.perms, rolePerms(me)));
}
function canTouch(me, u) { // darf me das Konto u verwalten?
  if (u.name === MAIN) return me.name === MAIN;
  if (u.role === 'owner') return me.name === MAIN;
  if (me.role === 'owner') return true;
  return u.name !== me.name && rankOf(u.role) < rankOf(me.role) && permsSubset((db.roles[u.role] || {}).perms, rolePerms(me));
}
function can(u, perm) { return !!rolePerms(u)[perm]; }
function canRead(u, cls) { return cls === 'Offen' ? can(u, 'open') : (cls === 'Intern' ? can(u, 'intern') : can(u, 'secret')); }
function rolesList() { return Object.keys(db.roles).sort(function (a, b) { const ra = a === 'owner' ? 99 : (db.roles[a].rank || 1), rb = b === 'owner' ? 99 : (db.roles[b].rank || 1); return rb - ra || String(db.roles[a].label).localeCompare(String(db.roles[b].label), 'de'); }).map(function (k) { return { key: k, label: db.roles[k].label, builtin: !!BUILTIN[k], rank: db.roles[k].rank || 1, perms: k === 'owner' ? ALLP : db.roles[k].perms }; }); }
/* Sichtbarkeit: leere Liste = alle Gruppen, sonst nur die genannten Gruppen (Schatten Leitung sieht immer alles) */
function canSee(u, it) { return !it || !Array.isArray(it.groups) || !it.groups.length || !!(u && (u.role === 'owner' || it.groups.indexOf(u.role) >= 0)); }
function cleanGroups(v) {
  if (!Array.isArray(v) || !v.length) return [];
  const out = [];
  v.forEach(function (k) { if (typeof k === 'string' && db.roles[k] && out.indexOf(k) < 0) out.push(k); });
  return out.length ? out : ['owner']; // eingeschränkt, aber keine gültige Gruppe: nur Schatten Leitung
}
function groupsList() { return Object.keys(db.roles).map(function (k) { return { key: k, label: db.roles[k].label }; }); }
/* Konten: Schlüssel = Name in Kleinbuchstaben, Anzeige = Name wie eingegeben (Groß/Klein, Leerzeichen) */
function userKey(n) { return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function cleanDisplay(n) {
  const d = String(n || '').trim().replace(/\s+/g, ' ');
  if (d.length < 3 || d.length > 40 || !/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(d)) {
    const e = new Error('Name: 3 bis 40 Zeichen aus Buchstaben, Zahlen, Leerzeichen, Punkt, Strich.'); e.status = 400; throw e;
  }
  return d;
}
function genSid() {
  const used = {}; Object.keys(db.users).forEach(function (k) { if (db.users[k].sid) used[db.users[k].sid] = 1; });
  for (;;) { const s = 'SD-' + crypto.randomInt(1000, 10000); if (!used[s]) return s; }
}
function cleanSid(v, self) {
  const s = String(v || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(s)) { const e = new Error('Schatten ID: 2 bis 20 Zeichen aus A-Z, 0-9 und Strich.'); e.status = 400; throw e; }
  Object.keys(db.users).forEach(function (k) { if (db.users[k] !== self && db.users[k].sid === s) { const e = new Error('Diese Schatten ID ist schon vergeben.'); e.status = 400; throw e; } });
  return s;
}
function dispName(u) { return (u && (u.display || u.name)) || ''; }
function stateNames() { return db.config.states.map(function (s) { return s.name; }); }
const CLASSES = ['Offen', 'Intern', 'Vertraulich', 'Geheim']; // Stufe = Mindestrolle zum Lesen (1..4)

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
/* ---------- Dauerhafter Speicher (optional): Upstash Redis per REST ---------- */
const REMOTE_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REMOTE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REMOTE = !!(REMOTE_URL && REMOTE_TOKEN);
const REMOTE_KEY = 'shadow:db';
let remoteBusy = false, remoteDirty = false, remoteOk = true;
async function remoteCmd(cmd) {
  const r = await fetch(REMOTE_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + REMOTE_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
  return j.result;
}
async function remoteFlush() {
  if (!REMOTE) return;
  if (remoteBusy) { remoteDirty = true; return; }
  remoteBusy = true;
  try {
    do { remoteDirty = false; await remoteCmd(['SET', REMOTE_KEY, JSON.stringify(db)]); remoteOk = true; } while (remoteDirty);
  } catch (e) { remoteOk = false; console.error('Dauerspeicher fehlgeschlagen:', e.message); setTimeout(remoteFlush, 5000); }
  remoteBusy = false;
}
async function remotePull() {
  if (!REMOTE) return;
  try {
    const val = await remoteCmd(['GET', REMOTE_KEY]);
    if (val) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DB_FILE, val, { mode: 0o600 }); console.log('Daten aus dem Dauerspeicher geladen.'); }
    else console.log('Dauerspeicher ist leer, starte mit Beispieldaten.');
  } catch (e) { console.error('Dauerspeicher nicht erreichbar:', e.message); }
}
function save() {
  remoteFlush();
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
  MAIN = name;
  const u = db.users[name];
  if (!u) {
    db.users[name] = {
      name, display: name.charAt(0).toUpperCase() + name.slice(1), sid: genSid(), role: 'owner', created: new Date().toISOString(), since: Date.now(),
      hash: process.env.OWNER_PASSWORD ? hashPw(process.env.OWNER_PASSWORD) : cfg.hash
    };
  } else {
    u.role = 'owner';
    if (process.env.OWNER_PASSWORD && !checkPw(process.env.OWNER_PASSWORD, u.hash)) {
      u.hash = hashPw(process.env.OWNER_PASSWORD);
      u.since = Date.now();
    }
  }
}

/* ---------- Gespeicherte Daten auf das aktuelle Format bringen ---------- */
function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function toMap(v, prefix) { // Objekt von Einträgen erzwingen (alte Stände konnten Listen sein), kaputte Einträge verwerfen
  const out = {};
  if (Array.isArray(v)) v.forEach(function (it, i) { if (isObj(it)) out[String(it.id || prefix + i).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40)] = it; });
  else if (isObj(v)) Object.keys(v).forEach(function (k) { if (isObj(v[k])) out[k] = v[k]; });
  return out;
}
function cleanNames(arr, fallback) {
  const seen = {}, out = [];
  (Array.isArray(arr) ? arr : []).forEach(function (x) {
    const n = str(isObj(x) ? x.name || x.n : x, 30);
    if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; out.push(n); }
  });
  return out.length ? out : fallback.slice();
}
function normalizeDb() {
  db.users = isObj(db.users) ? db.users : {};
  db.persons = toMap(db.persons, 'p');
  db.reports = toMap(db.reports, 'r');
  db.ops = toMap(db.ops, 'o');
  if (typeof db.rev !== 'number' || !isFinite(db.rev)) db.rev = 1;
  const c = isObj(db.config) ? db.config : {};
  const seenS = {}, states = [];
  (Array.isArray(c.states) ? c.states : []).forEach(function (x) {
    const n = str(isObj(x) ? x.name || x.n : x, 30);
    if (!n || seenS[n.toLowerCase()]) return;
    seenS[n.toLowerCase()] = 1;
    states.push({ name: n, color: COLORS.indexOf(isObj(x) && x.color) >= 0 ? x.color : 'amber', threat: !!(isObj(x) && x.threat) });
  });
  db.config = {
    ranks: cleanNames(c.ranks, DEFAULT_CONFIG.ranks),
    states: states.length ? states : JSON.parse(JSON.stringify(DEFAULT_CONFIG.states)),
    rtypes: cleanNames(c.rtypes, DEFAULT_CONFIG.rtypes)
  };
  const rr = isObj(db.roles) ? db.roles : {}, roles = {};
  Object.keys(BUILTIN).forEach(function (k) { roles[k] = { label: str(rr[k] && rr[k].label, 30) || BUILTIN[k].label, perms: isObj(rr[k]) && isObj(rr[k].perms) ? upgradePerms(rr[k].perms) : Object.assign({}, BUILTIN[k].perms) }; });
  Object.keys(rr).forEach(function (k) { if (!roles[k] && /^r[a-f0-9]{6,12}$/.test(k) && isObj(rr[k]) && str(rr[k].label, 30)) roles[k] = { label: str(rr[k].label, 30), perms: isObj(rr[k].perms) ? upgradePerms(rr[k].perms) : {} }; });
  Object.keys(roles).forEach(function (k) { const o = {}; PERMS.forEach(function (x) { o[x] = k === 'owner' ? true : !!roles[k].perms[x]; }); roles[k].perms = o; roles[k].rank = k === 'owner' ? RANK_OWNER : cleanRank(isObj(rr[k]) ? rr[k].rank : undefined, BUILTIN_RANK[k] || 1); });
  db.roles = roles;
  Object.keys(db.users).forEach(function (k) {
    const u = db.users[k];
    if (!isObj(u)) { delete db.users[k]; return; }
    if (typeof u.display !== 'string' || userKey(u.display) !== k) u.display = u.name || k;
  });
  Object.keys(db.users).forEach(function (k) { if (!db.users[k].sid) db.users[k].sid = genSid(); });
  if (!isObj(db.lockdown)) db.lockdown = { active: false };
  if (!isObj(db.inv)) db.inv = {};
  ['covers', 'informants', 'talks'].forEach(function (k) { if (!isObj(db.inv[k])) db.inv[k] = {}; });
  if (!isObj(db.ris)) db.ris = {};
  ['wachen', 'ris'].forEach(function (k) { if (!isObj(db.ris[k])) db.ris[k] = {}; });
  if (!Array.isArray(db.logs)) db.logs = [];
  if (!isObj(db.map)) db.map = { nodes: [], edges: [], rev: 1 };
  const keys = {};
  db.map.nodes = (Array.isArray(db.map.nodes) ? db.map.nodes : []).filter(function (n) {
    if (!isObj(n) || typeof n.k !== 'string' || keys[n.k]) return false;
    keys[n.k] = 1; return true;
  }).map(function (n) {
    return { k: n.k, id: str(n.id, 40) || n.k, x: isFinite(Number(n.x)) ? Math.max(0, Math.min(1, Number(n.x))) : 0.5, y: isFinite(Number(n.y)) ? Math.max(0, Math.min(1, Number(n.y))) : 0.5, s: n.s, i: str(n.i, 300) };
  });
  db.map.edges = (Array.isArray(db.map.edges) ? db.map.edges : []).filter(function (e) { return Array.isArray(e) && e.length === 2 && keys[e[0]] && keys[e[1]] && e[0] !== e[1]; });
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
  normalizeDb();
  Object.keys(db.ops).forEach(function (k) { const o = db.ops[k]; if (o && typeof o === 'object') { o.p = Number(o.p) >= 100 ? 100 : Math.floor((Number(o.p) || 0) / 25) * 25; o.ph = o.p / 25; } }); // alte Fortschrittswerte auf die festen Phasen umstellen
  if (!db.cfgV) { // einmalig: alte Statusnamen auf die neuen Labels umstellen
    Object.keys(db.persons).forEach(function (k) { const p = db.persons[k]; if (OLD_STATES[p.s]) p.s = OLD_STATES[p.s]; });
    if (db.map && Array.isArray(db.map.nodes)) db.map.nodes.forEach(function (n) { if (OLD_STATES[n.s]) n.s = OLD_STATES[n.s]; });
    db.cfgV = 1;
  }
  if (!db.purgedSeed) { // einmalig: frühere Beispieldaten (Akten p01.., Operationen o1..) entfernen
    Object.keys(db.persons).forEach(function (k) { if (/^p\d{2}$/.test(k)) delete db.persons[k]; });
    Object.keys(db.ops).forEach(function (k) { if (/^o\d$/.test(k)) delete db.ops[k]; });
    db.purgedSeed = true;
  }
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
  if (u.expires && u.expires <= Date.now()) return null; // temporäres Konto abgelaufen
  if (u.blocked) return null; // Konto gesperrt
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
/* Jedi Ermittler: Tarnidentitäten, Informanten, Gespräche (nur für Konten mit Ermittler-Freigabe) */
const INV_SPEC = {
  covers: { one: 'Tarnidentität', f: [
    { k: 'n', l: 'Tarnname', max: 60, req: 1 },
    { k: 'st', l: 'Status', max: 20, en: ['Aktiv', 'Ruhend', 'Verbrannt'], def: 'Aktiv' },
    { k: 'loc', l: 'Einsatzort', max: 60 },
    { k: 'bg', l: 'Legende', max: 2000 },
    { k: 'note', l: 'Notiz', max: 1000 }] },
  informants: { one: 'Informant', f: [
    { k: 'n', l: 'Name oder Deckname', max: 60, req: 1 },
    { k: 'rel', l: 'Zuverlässigkeit', max: 20, en: ['Unbekannt', 'Gering', 'Mittel', 'Hoch'], def: 'Unbekannt' },
    { k: 'st', l: 'Status', max: 20, en: ['Aktiv', 'Inaktiv', 'Abgeschaltet'], def: 'Aktiv' },
    { k: 'src', l: 'Zugang / Quelle', max: 120 },
    { k: 'contact', l: 'Kontaktweg', max: 120 },
    { k: 'loc', l: 'Ort', max: 60 },
    { k: 'note', l: 'Notiz', max: 1000 }] },
  talks: { one: 'Gespräch', f: [
    { k: 'ti', l: 'Betreff', max: 120, req: 1 },
    { k: 'when', l: 'Zeitpunkt', max: 30 },
    { k: 'with', l: 'Gesprächspartner', max: 80 },
    { k: 'cov', l: 'Tarnidentität', max: 60 },
    { k: 'inf', l: 'Informant', max: 60 },
    { k: 'loc', l: 'Ort', max: 60 },
    { k: 'text', l: 'Gesprächsprotokoll', max: 8000, req: 1 }] }
};
function needInv(req) {
  const u = need(req, 'viewer');
  if (!u.inv) { const e = new Error('Dieser Bereich ist nur für Jedi Ermittler freigegeben.'); e.status = 403; throw e; }
  return u;
}
function cleanInv(kind, b) {
  const o = {};
  if (!b || typeof b !== 'object') { const e = new Error('Ungültige Daten.'); e.status = 400; throw e; }
  INV_SPEC[kind].f.forEach(function (f) {
    let x = str(b[f.k], f.max);
    if (f.en) { if (x && f.en.indexOf(x) < 0) { const e = new Error('Ungültiger Wert bei „' + f.l + '“.'); e.status = 400; throw e; } if (!x) x = f.def; }
    if (f.req && !x) { const e = new Error('„' + f.l + '“ fehlt.'); e.status = 400; throw e; }
    o[f.k] = x;
  });
  return o;
}
function today() { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.'; }
function cleanPerson(b, partial) {
  const o = {};
  const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
  if (!b || typeof b !== 'object') bad('Ungültige Daten.');
  if ('n' in b || !partial) { o.n = str(b.n, 60); if (!o.n) bad('Name fehlt.'); }
  if ('r' in b || !partial) { if (db.config.ranks.indexOf(b.r) < 0) bad('Ungültiger Rang.'); o.r = b.r; }
  if ('s' in b || !partial) { if (stateNames().indexOf(b.s) < 0) bad('Ungültiger Status.'); o.s = b.s; }
  if ('p' in b || !partial) { const p = Number(b.p); if (!isFinite(p)) bad('Ungültiges Gefahrenlevel.'); o.p = Math.max(0, Math.min(100, Math.round(p))); }
  if ('l' in b || !partial) { o.l = str(b.l, 40) || 'Unbekannt'; }
  if ('note' in b || !partial) { o.note = str(b.note, 300) || 'Keine Notiz.'; }
  if ('seen' in b || !partial) { o.seen = /^\d{2}\.\d{2}\.$/.test(b.seen) ? b.seen : today(); }
  if ('watch' in b || !partial) { o.watch = !!b.watch; }
  if ('groups' in b || !partial) { o.groups = cleanGroups(b.groups); }
  if ('sp' in b || !partial) { o.sp = str(b.sp, 60); }
  if ('look' in b || !partial) { o.look = str(b.look, 2000); }
  if ('extra' in b || !partial) {
    const ex = Array.isArray(b.extra) ? b.extra : [];
    if (ex.length > 20) bad('Höchstens 20 weitere Felder.');
    o.extra = [];
    ex.forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      const k = str(x.k, 40), val = str(x.v, 1000);
      if (!k && !val) return;
      o.extra.push({ k: k || 'Feld', v: val });
    });
  }
  return o;
}
function fullDate() { const d = new Date(); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); }
function cleanReport(b, partial) {
  const o = {};
  const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
  if (!b || typeof b !== 'object') bad('Ungültige Daten.');
  if ('ti' in b || !partial) { o.ti = str(b.ti, 120); if (!o.ti) bad('Der Titel fehlt.'); }
  if ('t' in b || !partial) { if (db.config.rtypes.indexOf(b.t) < 0) bad('Ungültige Art.'); o.t = b.t; }
  if ('cls' in b || !partial) { if (CLASSES.indexOf(b.cls) < 0) bad('Ungültige Geheimhaltungsstufe.'); o.cls = b.cls; }
  if ('body' in b || !partial) { o.body = str(b.body, 8000); if (!o.body) bad('Der Berichtstext fehlt.'); }
  return o;
}
function clsLevel(c) { const i = CLASSES.indexOf(c); return i < 0 ? 4 : [1, 2, 3, 3][i]; } // Spektral Rat (editor) liest alles
const OP_SEED = [];
const RISKS = ['niedrig', 'mittel', 'hoch'];
const OP_PHASES = ['Planung', 'Mitglieder Sammlung', 'Briefing', 'Durchführung', 'Abgeschlossen']; // 0 / 25 / 50 / 75 / 100 %
function snapP(p) { return Math.max(0, Math.min(100, Math.round(Number(p) / 25) * 25)); }
function cleanOp(b, partial) {
  const o = {};
  const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
  if (!b || typeof b !== 'object') bad('Ungültige Daten.');
  if ('n' in b || !partial) { o.n = str(b.n, 60); if (!o.n) bad('Der Name fehlt.'); }
  if ('c' in b || !partial) { o.c = str(b.c, 40); if (!o.c) bad('Das Einsatzgebiet fehlt.'); }
  if ('loc' in b || !partial) { o.loc = str(b.loc, 40); if (!o.loc) bad('Der Ort fehlt.'); }
  if ('risk' in b || !partial) { if (RISKS.indexOf(b.risk) < 0) bad('Ungültiges Risiko.'); o.risk = b.risk; }
  if ('p' in b || 'ph' in b || !partial) {
    const p = 'p' in b ? Number(b.p) : ('ph' in b ? Number(b.ph) * 25 : 0);
    if (!isFinite(p)) bad('Ungültige Phase.');
    o.p = snapP(p); o.ph = o.p / 25; // Phasen: 0 Planung, 25 Mitglieder Sammlung, 50 Briefing, 75 Durchführung, 100 Abgeschlossen
  }
  if ('groups' in b || !partial) { o.groups = cleanGroups(b.groups); }
  return o;
}
function cleanConfig(b) {
  const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
  if (!b || typeof b !== 'object') bad('Ungültige Daten.');
  const cur = db.config;
  const prep = function (arr, curNames, label, max, withState) {
    if (!Array.isArray(arr) || arr.length < 1 || arr.length > max) bad(label + ': 1 bis ' + max + ' Einträge.');
    const names = {}, origs = {};
    return arr.map(function (it) {
      if (!it || typeof it !== 'object') bad('Ungültiger Eintrag.');
      const n = str(it.n, 30);
      if (!n) bad(label + ': Ein Name fehlt.');
      if (names[n.toLowerCase()]) bad(label + ': „' + n + '“ gibt es doppelt.');
      names[n.toLowerCase()] = 1;
      let o = null;
      if (typeof it.o === 'string' && it.o) {
        if (curNames.indexOf(it.o) < 0 || origs[it.o]) bad(label + ': Ungültiger Bezug.');
        origs[it.o] = 1; o = it.o;
      }
      const r = { o: o, n: n };
      if (withState) {
        if (COLORS.indexOf(it.color) < 0) bad('Ungültige Farbe.');
        r.color = it.color; r.threat = !!it.threat;
      }
      return r;
    });
  };
  const ranks = prep(b.ranks, cur.ranks, 'Ränge', 30, false);
  const states = prep(b.states, stateNames(), 'Labels', 12, true);
  const rtypes = prep(b.rtypes, cur.rtypes, 'Berichtsarten', 8, false);
  // Entfernte Einträge dürfen nirgends mehr verwendet werden
  const gone = function (list, curNames, count, label) {
    const kept = {}; list.forEach(function (x) { if (x.o) kept[x.o] = 1; });
    curNames.forEach(function (nm) {
      if (kept[nm]) return;
      const c = count(nm);
      if (c > 0) bad(label + ' „' + nm + '“ wird noch von ' + c + ' Einträgen verwendet. Weise zuerst etwas anderes zu oder benenne ihn um.');
    });
  };
  const nodes = (db.map && db.map.nodes) || [];
  gone(ranks, cur.ranks, function (nm) { return Object.keys(db.persons).filter(function (k) { return db.persons[k].r === nm; }).length; }, 'Rang');
  gone(states, stateNames(), function (nm) {
    return Object.keys(db.persons).filter(function (k) { return db.persons[k].s === nm; }).length + nodes.filter(function (n) { return n.s === nm; }).length;
  }, 'Label');
  gone(rtypes, cur.rtypes, function (nm) { return Object.keys(db.reports).filter(function (k) { return db.reports[k].t === nm; }).length; }, 'Berichtsart');
  const map = function (list) { const m = {}; list.forEach(function (x) { if (x.o && x.o !== x.n) m[x.o] = x.n; }); return m; };
  return { ranks: ranks, states: states, rtypes: rtypes, rr: map(ranks), rs: map(states), rt: map(rtypes) };
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
    if (stateNames().indexOf(n.s) < 0) bad('Ungültiger Status.');
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
function need(req, perm) {
  const u = sessionUser(req);
  if (!u) { const e = new Error('Bitte melde dich an.'); e.status = 401; throw e; }
  if (perm === 'owner' ? u.role !== 'owner' : (perm !== 'viewer' && !can(u, perm))) { const e = new Error('Dafür fehlen dir die Rechte.'); e.status = 403; throw e; }
  return u;
}
let MAIN = '';
function publicUser(u) { return { name: u.name, display: dispName(u), sid: u.sid || '', role: u.role, label: (db.roles[u.role] || {}).label || u.role, perms: u.ris ? {} : rolePerms(u), rank: rankOf(u.role), inv: !!u.inv && !u.ris, ris: !!u.ris, main: u.name === MAIN, mustChange: !!u.mustChange, expires: u.expires || 0 }; }
function cleanUntil(x) {
  const n = Number(x), now = Date.now();
  if (!isFinite(n) || n < now + 60000 || n > now + 400 * 86400000) { const e = new Error('Das Ablaufdatum muss zwischen 1 Minute und 400 Tagen in der Zukunft liegen.'); e.status = 400; throw e; }
  return Math.round(n);
}
function untilTxt(t) { return new Date(t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function newId() { return crypto.randomBytes(6).toString('hex'); }
function validPassword(p) {
  if (typeof p !== 'string' || p.length < 5 || p.length > 200 || !/\p{L}/u.test(p) || !/[0-9]/.test(p)) {
    const e = new Error('Das Passwort braucht mindestens 5 Zeichen mit Buchstaben und Zahlen.'); e.status = 400; throw e;
  }
}
function genPassword() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', D = '23456789', ALL = L + D;
  for (;;) {
    let s = '';
    for (let i = 0; i < 12; i++) s += ALL[crypto.randomInt(ALL.length)];
    if (/[A-Za-z]/.test(s) && /[0-9]/.test(s)) return s.replace(/(.{4})(?=.)/g, '$1-');
  }
}

async function api(req, res, url) {
  const method = req.method, p = url.pathname;
  if (method !== 'GET') {
    if (req.headers['x-requested-with'] !== 'shadow-net' || !/^application\/json/.test(req.headers['content-type'] || (method === 'DELETE' ? 'application/json' : ''))) {
      return send(res, 400, { error: 'Ungültige Anfrage.' });
    }
  }
  if (db.lockdown.active && ['/api/session', '/api/login', '/api/logout'].indexOf(p) < 0) {
    const lu = sessionUser(req);
    if (lu && !can(lu, 'lockdown')) return send(res, 403, { error: 'Notfall: Die Seite ist für dein Konto gesperrt.', code: 'lockdown' });
  }
  if (['/api/session', '/api/login', '/api/logout', '/api/password'].indexOf(p) < 0 && !/^\/api\/ris(\/|$)/.test(p)) {
    const ru0 = sessionUser(req);
    if (ru0 && ru0.ris) return send(res, 403, { error: 'Dieses Konto hat nur Zugriff auf „RIS Kooperation“.', code: 'ris_only' });
  }
  if (['/api/session', '/api/login', '/api/logout', '/api/password'].indexOf(p) < 0) {
    const cu = sessionUser(req);
    if (cu && cu.mustChange) return send(res, 403, { error: 'Bitte vergib zuerst ein eigenes Passwort.', code: 'must_change' });
  }
  if (p === '/api/session' && method === 'GET') {
    const u = sessionUser(req);
    return send(res, 200, { user: u ? publicUser(u) : null, lockdown: !!db.lockdown.active });
  }
  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const ip = clientIp(req), name = userKey(str(b.username, 60));
    if (limited('ip:' + ip, 8) || limited('u:' + name, 30)) return send(res, 429, { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' });
    const u = db.users[name];
    const ok = u ? checkPw(String(b.password || ''), u.hash) : (checkPw('x', 'scrypt$00$00'), false);
    if (!ok) { fail('ip:' + ip); fail('u:' + name); logAct(u || null, 'Anmeldung fehlgeschlagen', u ? '' : 'Name: ' + name); save(); return send(res, 401, { error: 'Benutzername oder Passwort stimmt nicht.' }); }
    if (u.blocked) { logAct(u, 'Anmeldung abgelehnt', 'Konto gesperrt'); save(); return send(res, 401, { error: 'Dieses Konto ist gesperrt. Bitte wende dich an die Schatten Leitung.' }); }
    if (u.expires && u.expires <= Date.now()) { logAct(u, 'Anmeldung abgelehnt', 'Temporäres Konto abgelaufen'); save(); return send(res, 401, { error: 'Dieses temporäre Konto ist abgelaufen. Bitte die Schatten Leitung um eine Verlängerung.' }); }
    fails.delete('ip:' + ip); fails.delete('u:' + name);
    setCookie(res, req, makeToken(u.name), Math.floor(SESSION_MS / 1000));
    logAct(u, 'Anmeldung', ''); save();
    return send(res, 200, { user: publicUser(u), lockdown: !!db.lockdown.active });
  }
  if (p === '/api/logout' && method === 'POST') {
    const lo = sessionUser(req);
    if (lo) { logAct(lo, 'Abmeldung', ''); save(); }
    setCookie(res, req, '', 0);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/data' && method === 'GET') {
    need(req, 'viewer');
    const since = Number(url.searchParams.get('since'));
    if (since === db.rev) return send(res, 200, { same: true, rev: db.rev });
    const me = sessionUser(req);
    const persons = Object.keys(db.persons).filter(function (id) { return canSee(me, db.persons[id]); })
      .map(function (id) { const x = db.persons[id]; return Object.assign({ id: id }, x, { files: (Array.isArray(x.files) ? x.files : []).filter(function (f) { return canSee(me, f); }) }); })
      .sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    const reports = Object.keys(db.reports).map(function (id) { const x = db.reports[id]; return Object.assign({ id: id }, x, { files: (Array.isArray(x.files) ? x.files : []).filter(function (f) { return canSee(me, f); }) }); })
      .filter(function (r) { return canRead(me, r.cls); })
      .sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return send(res, 200, { me: publicUser(me), groups: groupsList(), rev: db.rev, persons: persons, map: db.map, reports: reports, config: db.config, lockdown: !!db.lockdown.active,
      ops: Object.keys(db.ops).filter(function (id) { return canSee(me, db.ops[id]); }).map(function (id) { return Object.assign({ id: id }, db.ops[id]); }).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); }) });
  }
  if (p === '/api/persons' && method === 'POST') {
    const cu0 = need(req, 'persons');
    if (Object.keys(db.persons).length >= 2000) return send(res, 400, { error: 'Das Register ist voll.' });
    const o = cleanPerson(await readBody(req), false);
    o.ts = Date.now();
    const id = newId();
    db.persons[id] = o; logAct(cu0, 'Person angelegt', o.n + ' (' + o.r + ', ' + o.s + ')'); bump();
    return send(res, 200, { id: id });
  }
  const fm = /^\/api\/(persons|reports)\/([A-Za-z0-9_-]{1,40})\/files(?:\/([A-Za-z0-9_-]{1,40}))?$/.exec(p);
  if (fm) {
    const isRep = fm[1] === 'reports';
    const W = isRep ? { perm: 'reports', one: 'Anhang', what: 'Bericht', max: 100 } : { perm: 'files', one: 'Akte', what: 'Person', max: 200 };
    const u = need(req, W.perm);
    const par = isRep ? db.reports[fm[2]] : db.persons[fm[2]];
    if (!par || (isRep ? !canRead(u, par.cls) : !canSee(u, par))) return send(res, 404, { error: W.what + ' nicht gefunden.' });
    const parName = isRep ? par.ti : par.n;
    par.files = Array.isArray(par.files) ? par.files : [];
    const clean = function (b) {
      const text = str(b && b.text, 8000); if (!text) { const e = new Error('Der Text fehlt.'); e.status = 400; throw e; }
      return { title: str(b.title, 120) || W.one, text: text, groups: cleanGroups(b.groups) };
    };
    if (!fm[3] && method === 'POST') {
      if (par.files.length >= W.max) return send(res, 400, { error: 'Zu viele Einträge bei diesem ' + (isRep ? 'Bericht' : 'Eintrag') + '.' });
      const f = Object.assign(clean(await readBody(req)), { id: newId(), ts: Date.now(), by: u.name, byName: dispName(u) });
      par.files.push(f); logAct(u, W.one + ' hinzugefügt', parName + ': ' + f.title); bump();
      return send(res, 200, { id: f.id });
    }
    const f = fm[3] && par.files.filter(function (x) { return x.id === fm[3] && canSee(u, x); })[0];
    if (!f) return send(res, 404, { error: W.one + ' nicht gefunden.' });
    if (f.by !== u.name && !can(u, 'others')) return send(res, 403, { error: 'Fremde Einträge ändern nur Gruppen mit dem Recht „Fremde Inhalte“.' });
    if (method === 'PATCH') { Object.assign(f, clean(await readBody(req)), { edited: Date.now() }); logAct(u, W.one + ' geändert', parName + ': ' + f.title); bump(); return send(res, 200, { ok: true }); }
    if (method === 'DELETE') { par.files = par.files.filter(function (x) { return x !== f; }); logAct(u, W.one + ' gelöscht', parName + ': ' + f.title); bump(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/roles' && method === 'PUT') {
    const ru = need(req, 'groups');
    const b = await readBody(req);
    const bad = function (m) { const e = new Error(m); e.status = 400; throw e; };
    if (!b || !Array.isArray(b.roles) || b.roles.length > 20) bad('Ungültige Gruppen (maximal 20).');
    const out = {}, names = {};
    b.roles.forEach(function (r) {
      if (!r || typeof r !== 'object') bad('Ungültige Gruppe.');
      const label = str(r.label, 30); if (!label) bad('Jede Gruppe braucht einen Namen.');
      if (names[label.toLowerCase()]) bad('„' + label + '“ gibt es doppelt.');
      names[label.toLowerCase()] = 1;
      let key = typeof r.key === 'string' && db.roles[r.key] ? r.key : 'r' + crypto.randomBytes(4).toString('hex');
      if (out[key]) bad('Gruppe doppelt.');
      const perms = {}; PERMS.forEach(function (x) { perms[x] = key === 'owner' ? true : !!(r.perms && r.perms[x]); });
      out[key] = { label: label, perms: perms, rank: key === 'owner' ? RANK_OWNER : cleanRank(r.rank, db.roles[key] ? db.roles[key].rank : 1) };
    });
    Object.keys(db.roles).forEach(function (k) {
      if (out[k]) return;
      if (BUILTIN[k]) bad('Die Grundgruppe „' + db.roles[k].label + '“ kann nicht entfernt werden.');
      const n = Object.keys(db.users).filter(function (x) { return db.users[x].role === k; }).length;
      if (n) bad('Die Gruppe „' + db.roles[k].label + '“ hat noch ' + n + ' Konto/Konten. Weise ihnen zuerst eine andere Gruppe zu.');
    });
    if (ru.role !== 'owner') {
      const mine = rolePerms(ru);
      Object.keys(out).forEach(function (k) {
        const old = db.roles[k];
        const pmChanged = PERMS.some(function (x) { return !!out[k].perms[x] !== !!(old && old.perms[x]); });
        const lblChanged = !old || old.label !== out[k].label || old.rank !== out[k].rank;
        if (lblChanged && (out[k].rank >= rankOf(ru.role) || (old && old.rank >= rankOf(ru.role)))) bad('Du kannst nur Gruppen mit niedrigerem Rang als deinem eigenen (Rang ' + rankOf(ru.role) + ') anlegen oder ändern. „' + out[k].label + '“ ist nicht niedriger.');
        PERMS.forEach(function (x) { if (!!out[k].perms[x] !== !!(old && old.perms[x]) && !mine[x]) bad('Du kannst nur Rechte vergeben oder entziehen, die du selbst hast („' + PERM_LBL[x] + '“ nicht).'); });
        if (old && (pmChanged || lblChanged) && !permsSubset(old.perms, mine)) bad('Die Gruppe „' + old.label + '“ hat mehr Rechte als du und lässt sich nur von der Schatten Leitung ändern.');
      });
      Object.keys(db.roles).forEach(function (k) { if (!out[k] && (db.roles[k].rank >= rankOf(ru.role) || !permsSubset(db.roles[k].perms, mine))) bad('Die Gruppe „' + db.roles[k].label + '“ hat mehr Rechte als du und lässt sich nur von der Schatten Leitung entfernen.'); });
    }
    db.roles = out;
    const fix = function (it) {
      if (!it || !Array.isArray(it.groups) || !it.groups.length) return;
      it.groups = it.groups.filter(function (k) { return !!db.roles[k]; });
      if (!it.groups.length) it.groups = ['owner']; // bleibt eingeschränkt
    };
    Object.keys(db.persons).forEach(function (k) { const x = db.persons[k]; fix(x); (Array.isArray(x.files) ? x.files : []).forEach(fix); });
    Object.keys(db.ops).forEach(function (k) { fix(db.ops[k]); });
    Object.keys(db.reports).forEach(function (k) { (Array.isArray(db.reports[k].files) ? db.reports[k].files : []).forEach(fix); });
    logAct(ru, 'Gruppen und Rechte geändert', Object.keys(out).map(function (k) { const pm = out[k].perms; return out[k].label + ': ' + (PERMS.filter(function (x) { return pm[x]; }).map(function (x) { return PERM_LBL[x]; }).join(', ') || 'keine'); }).join(' | '));
    bump();
    return send(res, 200, { ok: true, roles: rolesList() });
  }
  let m = /^\/api\/persons\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (m) {
    const pu = need(req, 'persons');
    const cur = db.persons[m[1]];
    if (!cur || !canSee(pu, cur)) return send(res, 404, { error: 'Akte nicht gefunden.' });
    if (method === 'PATCH') {
      const o = cleanPerson(await readBody(req), true);
      const LBL = { n: 'Name', r: 'Rang', s: 'Zugehörigkeit', p: 'Gefahrenlevel', l: 'Ort', note: 'Notiz', watch: 'Beschattung', groups: 'Sichtbarkeit', sp: 'Spezies', look: 'Aussehen', extra: 'Weitere Felder' };
      const ch = [];
      Object.keys(o).forEach(function (k) {
        if (JSON.stringify(o[k]) === JSON.stringify(cur[k])) return;
        if (k === 'r' || k === 's' || k === 'p' || k === 'n' || k === 'l') ch.push(LBL[k] + ': ' + cur[k] + ' → ' + o[k]);
        else if (k === 'watch') ch.push(o.watch ? 'Beschattung gestartet' : 'Beschattung beendet');
        else if (LBL[k]) ch.push(LBL[k] + ' geändert');
      });
      const before = cur.n;
      Object.assign(cur, o); if (ch.length) logAct(pu, 'Person geändert', before + ' (' + ch.join(', ') + ')'); bump();
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') { logAct(pu, 'Person entfernt', cur.n); delete db.persons[m[1]]; bump(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/reports' && method === 'POST') {
    const u = need(req, 'reports');
    if (Object.keys(db.reports).length >= 1000) return send(res, 400, { error: 'Das Berichtsarchiv ist voll.' });
    const o = cleanReport(await readBody(req), false);
    if (!canRead(u, o.cls)) return send(res, 403, { error: 'Diese Geheimhaltungsstufe darfst du nicht vergeben.' });
    o.by = u.name; o.byName = dispName(u); o.d = fullDate(); o.ts = Date.now();
    const id = newId();
    db.reports[id] = o; logAct(u, 'Bericht angelegt', o.t + ' · ' + o.cls + ': ' + o.ti); bump();
    return send(res, 200, { id: id });
  }
  const rm = /^\/api\/reports\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (rm) {
    const u = need(req, 'reports');
    const cur = db.reports[rm[1]];
    if (!cur || !canRead(u, cur.cls)) return send(res, 404, { error: 'Bericht nicht gefunden.' });
    if (cur.by !== u.name && !can(u, 'others')) return send(res, 403, { error: 'Fremde Berichte bearbeiten nur Gruppen mit dem Recht „Fremde Inhalte“.' });
    if (method === 'PATCH') {
      const o = cleanReport(await readBody(req), true);
      if (o.cls && !canRead(u, o.cls)) return send(res, 403, { error: 'Diese Geheimhaltungsstufe darfst du nicht vergeben.' });
      Object.assign(cur, o); cur.edited = fullDate(); logAct(u, 'Bericht geändert', cur.t + ' · ' + cur.cls + ': ' + cur.ti); bump();
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') { logAct(u, 'Bericht gelöscht', cur.ti); delete db.reports[rm[1]]; bump(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/ops' && method === 'POST') {
    const su = need(req, 'opsStart');
    if (Object.keys(db.ops).length >= 200) return send(res, 400, { error: 'Zu viele Operationen.' });
    const o = cleanOp(Object.assign({ p: 0, ph: 0 }, await readBody(req)), false);
    o.ts = Date.now();
    const id = newId();
    db.ops[id] = o; logAct(su, 'Operation gestartet', o.n + ' (' + o.c + ', ' + o.loc + ')'); bump();
    return send(res, 200, { id: id });
  }
  const om = /^\/api\/ops\/([A-Za-z0-9_-]{1,40})$/.exec(p);
  if (om) {
    const ou = need(req, 'opsManage');
    const cur = db.ops[om[1]];
    if (!cur || !canSee(ou, cur)) return send(res, 404, { error: 'Operation nicht gefunden.' });
    if (method === 'PATCH') {
      const o = cleanOp(await readBody(req), true), ch = [];
      if (o.n !== undefined && o.n !== cur.n) ch.push('umbenannt in „' + o.n + '“');
      if (o.p !== undefined && o.p !== cur.p) ch.push('Phase: ' + OP_PHASES[snapP(cur.p) / 25] + ' → ' + OP_PHASES[o.p / 25] + ' (' + o.p + ' %)');
      if (o.groups !== undefined && JSON.stringify(o.groups) !== JSON.stringify(cur.groups || [])) ch.push('Sichtbarkeit geändert');
      const before = cur.n;
      Object.assign(cur, o); if (ch.length) logAct(ou, 'Operation geändert', before + ': ' + ch.join(', ')); bump(); return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') { logAct(ou, cur.p >= 100 ? 'Operation archiviert' : 'Operation abgebrochen', cur.n); delete db.ops[om[1]]; bump(); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/config' && method === 'PUT') {
    const cfu = need(req, 'config');
    const c = cleanConfig(await readBody(req));
    Object.keys(db.persons).forEach(function (k) { const x = db.persons[k]; if (c.rr[x.r]) x.r = c.rr[x.r]; if (c.rs[x.s]) x.s = c.rs[x.s]; });
    Object.keys(db.reports).forEach(function (k) { const x = db.reports[k]; if (c.rt[x.t]) x.t = c.rt[x.t]; });
    if (db.map && db.map.nodes) db.map.nodes.forEach(function (n) { if (c.rs[n.s]) n.s = c.rs[n.s]; });
    db.config = {
      ranks: c.ranks.map(function (x) { return x.n; }),
      states: c.states.map(function (x) { return { name: x.n, color: x.color, threat: x.threat }; }),
      rtypes: c.rtypes.map(function (x) { return x.n; })
    };
    logAct(cfu, 'Anpassung geändert', 'Ränge: ' + db.config.ranks.join(', ') + ' | Labels: ' + db.config.states.map(function (x) { return x.name; }).join(', ') + ' | Berichtsarten: ' + db.config.rtypes.join(', '));
    bump();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/lockdown' && method === 'POST') {
    const me = need(req, 'lockdown');
    const b = await readBody(req);
    db.lockdown = b.active === true ? { active: true, by: me.name, ts: Date.now() } : { active: false };
    logAct(me, db.lockdown.active ? 'Notfall UMBRA ausgelöst' : 'Notfall UMBRA beendet', '');
    bump();
    return send(res, 200, { ok: true, lockdown: db.lockdown.active });
  }
  if (p === '/api/map' && method === 'PUT') {
    const mu = need(req, 'map');
    db.map = cleanMap(await readBody(req)); logAct(mu, 'Karte geändert', db.map.nodes.length + ' Systeme, ' + db.map.edges.length + ' Routen'); bump();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/password' && method === 'POST') {
    const u = need(req, 'viewer');
    const b = await readBody(req);
    if (!checkPw(String(b.current || ''), u.hash)) return send(res, 400, { error: 'Das aktuelle Passwort stimmt nicht.' });
    validPassword(b.next);
    if (checkPw(String(b.next), u.hash)) return send(res, 400, { error: 'Das neue Passwort muss sich vom bisherigen unterscheiden.' });
    const first = !!u.mustChange;
    u.hash = hashPw(b.next); u.since = Date.now(); u.mustChange = false; logAct(u, first ? 'Eigenes Passwort gewählt (erste Anmeldung)' : 'Passwort geändert', ''); save();
    setCookie(res, req, makeToken(u.name), Math.floor(SESSION_MS / 1000));
    return send(res, 200, { ok: true, user: publicUser(u) });
  }
  if (p === '/api/logs' && method === 'GET') {
    need(req, 'logs');
    const lim = Math.max(1, Math.min(LOG_MAX, Number(url.searchParams.get('limit')) || 1000));
    return send(res, 200, { total: db.logs.length, logs: db.logs.slice(-lim).reverse() });
  }
  if (p === '/api/users' && method === 'GET') {
    const lu = need(req, 'viewer');
    if (!can(lu, 'accounts') && !can(lu, 'groups')) return send(res, 403, { error: 'Dafür fehlen dir die Rechte.' });
    return send(res, 200, { roles: rolesList(), storage: REMOTE ? (remoteOk ? 'remote' : 'remote-error') : 'file', users: !can(lu, 'accounts') ? [] : Object.keys(db.users).sort(function (a, b) { const ua = db.users[a], ub = db.users[b]; return (b === MAIN) - (a === MAIN) || rankOf(ub.role) - rankOf(ua.role) || String(dispName(ua)).localeCompare(String(dispName(ub)), 'de'); }).map(function (k) { const u = db.users[k]; return { name: u.name, display: dispName(u), sid: u.sid || '', role: u.role, roleLabel: (db.roles[u.role] || {}).label, created: u.created, expires: u.expires || 0, blocked: !!u.blocked, inv: !!u.inv, ris: !!u.ris, main: u.name === MAIN, mustChange: !!u.mustChange }; }) });
  }
  if (p === '/api/users' && method === 'POST') {
    const me = need(req, 'accounts');
    const b = await readBody(req);
    const display = cleanDisplay(b.username);
    const name = userKey(display);
    if (db.users[name]) return send(res, 400, { error: 'Diesen Namen gibt es schon.' });
    if (!db.roles[b.role]) return send(res, 400, { error: 'Ungültige Rolle.' });
    if (b.role === 'owner' && me.name !== MAIN) return send(res, 403, { error: 'Schatten-Leitungs-Konten legt nur das Haupt-Owner-Konto an.' });
    if (!b.ris && !canAssign(me, b.role)) return send(res, 403, { error: 'Du kannst nur Gruppen vergeben, deren Rechte du selbst hast.' });
    if (b.inv && me.role !== 'owner') return send(res, 403, { error: 'Die Ermittler-Freigabe vergibt nur die Schatten Leitung.' });
    const isRis = !!b.ris;
    if (isRis && b.inv) return send(res, 400, { error: 'RIS-Konten können keine Jedi Ermittler sein.' });
    if (isRis) b.role = 'viewer';
    let until = 0;
    if (b.until) { if (b.role === 'owner') return send(res, 400, { error: 'Schatten-Leitungs-Konten können nicht befristet werden.' }); until = cleanUntil(b.until); }
    const pw = genPassword();
    const sid = b.sid ? cleanSid(b.sid, null) : genSid();
    db.users[name] = { name: name, display: display, sid: sid, role: b.role, hash: hashPw(pw), created: new Date().toISOString(), since: Date.now(), mustChange: true };
    if (until) db.users[name].expires = until;
    if (b.inv) db.users[name].inv = true;
    if (isRis) db.users[name].ris = true;
    logAct(me, 'Konto angelegt', display + ' (' + sid + ', ' + ((db.roles[b.role] || {}).label || b.role) + (until ? ', befristet bis ' + untilTxt(until) : '') + (b.inv ? ', Jedi Ermittler' : '') + (isRis ? ', RIS-Konto' : '') + ')');
    save();
    return send(res, 200, { ok: true, username: display, sid: sid, password: pw });
  }
  if (p === '/api/inv' && method === 'GET') {
    needInv(req);
    const out = {};
    Object.keys(INV_SPEC).forEach(function (k) {
      out[k] = Object.keys(db.inv[k]).map(function (id) { return Object.assign({ id: id }, db.inv[k][id]); }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    });
    return send(res, 200, out);
  }
  m = /^\/api\/inv\/(covers|informants|talks)(?:\/([a-f0-9]{6,20}))?$/.exec(p);
  if (m) {
    const iu = needInv(req), kind = m[1], one = INV_SPEC[kind].one;
    if (!m[2] && method === 'POST') {
      if (Object.keys(db.inv[kind]).length >= 500) return send(res, 400, { error: 'Zu viele Einträge.' });
      const o = cleanInv(kind, await readBody(req));
      const id = newId();
      Object.assign(o, { ts: Date.now(), by: dispName(iu), bk: iu.name });
      db.inv[kind][id] = o;
      logAct(iu, 'Ermittler: ' + one + ' angelegt', ''); // bewusst ohne Inhalt: Logs sehen auch Konten ohne Ermittler-Freigabe
      bump();
      return send(res, 200, { ok: true, id: id });
    }
    const cur = m[2] ? db.inv[kind][m[2]] : null;
    if (m[2] && !cur) return send(res, 404, { error: one + ' nicht gefunden.' });
    if (cur && (method === 'PATCH' || method === 'DELETE')) {
      if (cur.bk !== iu.name && !can(iu, 'others')) return send(res, 403, { error: 'Fremde Einträge ändern nur Konten mit dem Recht „Fremde Inhalte“.' });
      if (method === 'PATCH') {
        Object.assign(cur, cleanInv(kind, await readBody(req)), { edited: Date.now() });
        logAct(iu, 'Ermittler: ' + one + ' geändert', ''); bump();
        return send(res, 200, { ok: true });
      }
      delete db.inv[kind][m[2]];
      logAct(iu, 'Ermittler: ' + one + ' gelöscht', ''); bump();
      return send(res, 200, { ok: true });
    }
  }
  /* RIS Kooperation: Berichtsaustausch zwischen Wächtern und RIS */
  const RIS_BOARDS = { wachen: 'Berichts Austausch Wachen', ris: 'Berichts Austausch RIS' };
  const risSide = function (u) { return u.ris ? 'ris' : (can(u, 'ris') ? 'intern' : null); };
  const risWrite = function (u, board) { return board === 'ris' ? !!u.ris : (!u.ris && can(u, 'ris')); };
  if (p === '/api/ris' && method === 'GET') {
    const ru = need(req, 'viewer'), side = risSide(ru);
    if (!side) return send(res, 403, { error: 'Dafür fehlen dir die Rechte.' });
    const out = { side: side, write: { wachen: risWrite(ru, 'wachen'), ris: risWrite(ru, 'ris') }, others: side === 'intern' && can(ru, 'others') };
    Object.keys(RIS_BOARDS).forEach(function (k) {
      out[k] = Object.keys(db.ris[k]).map(function (id) { return Object.assign({ id: id }, db.ris[k][id]); }).sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    });
    return send(res, 200, out);
  }
  m = /^\/api\/ris\/(wachen|ris)(?:\/([a-f0-9]{6,20}))?$/.exec(p);
  if (m) {
    const ru = need(req, 'viewer'), board = m[1], bname = RIS_BOARDS[board];
    if (!risSide(ru)) return send(res, 403, { error: 'Dafür fehlen dir die Rechte.' });
    const clean = function (b) {
      if (!b || typeof b !== 'object') { const e = new Error('Ungültige Daten.'); e.status = 400; throw e; }
      const o = { ti: str(b.ti, 120), ref: str(b.ref, 60), text: str(b.text, 8000) };
      if (!o.ti) { const e = new Error('Der Titel fehlt.'); e.status = 400; throw e; }
      if (!o.text) { const e = new Error('Der Berichtstext fehlt.'); e.status = 400; throw e; }
      return o;
    };
    if (!m[2] && method === 'POST') {
      if (!risWrite(ru, board)) return send(res, 403, { error: 'In „' + bname + '“ darf dein Konto nicht schreiben.' });
      if (Object.keys(db.ris[board]).length >= 1000) return send(res, 400, { error: 'Zu viele Berichte.' });
      const o = clean(await readBody(req)), id = newId();
      Object.assign(o, { ts: Date.now(), by: dispName(ru), bk: ru.name });
      db.ris[board][id] = o;
      logAct(ru, 'RIS: Bericht angelegt', bname + ': ' + o.ti); bump();
      return send(res, 200, { ok: true, id: id });
    }
    const cur = m[2] ? db.ris[board][m[2]] : null;
    if (m[2] && !cur) return send(res, 404, { error: 'Bericht nicht gefunden.' });
    if (cur && (method === 'PATCH' || method === 'DELETE')) {
      if (!risWrite(ru, board)) return send(res, 403, { error: board === 'ris' ? '„' + bname + '“ bearbeiten nur RIS-Konten.' : '„' + bname + '“ bearbeiten nur Konten der Wächter-Seite mit dem Recht „RIS Kooperation“.' });
      if (method === 'PATCH') {
        Object.assign(cur, clean(await readBody(req)), { edited: Date.now() });
        logAct(ru, 'RIS: Bericht geändert', bname + ': ' + cur.ti); bump();
        return send(res, 200, { ok: true });
      }
      logAct(ru, 'RIS: Bericht gelöscht', bname + ': ' + cur.ti);
      delete db.ris[board][m[2]]; bump();
      return send(res, 200, { ok: true });
    }
  }
  m = /^\/api\/users\/([^/]{1,200})$/.exec(p);
  if (m) {
    const me = need(req, 'accounts');
    let key = '';
    try { key = userKey(decodeURIComponent(m[1])); } catch (e) { return send(res, 400, { error: 'Ungültiger Name.' }); }
    const u = db.users[key];
    if (!u) return send(res, 404, { error: 'Konto nicht gefunden.' });
    if (u.role === 'owner' && u.name !== MAIN && me.name !== MAIN) return send(res, 403, { error: 'Schatten-Leitungs-Konten verwaltet nur das Haupt-Owner-Konto.' });
    if (u.name !== MAIN && !canTouch(me, u)) return send(res, 403, { error: 'Dieses Konto hat mehr Rechte als du oder ist dein eigenes. Es lässt sich nur von der Schatten Leitung verwalten.' });
    // Haupt-Owner: nur Schreibweise des Namens und Schatten ID, und nur durch sich selbst
    if (u.name === MAIN && (method !== 'PATCH' || me.name !== MAIN)) return send(res, 400, { error: 'Das Haupt-Owner-Konto kann hier nicht geändert werden.' });
    if (method === 'PATCH') {
      const b = await readBody(req);
      if (u.name === MAIN && ('role' in b || b.reset === true)) return send(res, 400, { error: 'Rolle und Passwort des Haupt-Owner-Kontos sind hier nicht änderbar.' });
      const uch = [];
      if ('display' in b) {
        const d = cleanDisplay(b.display);
        if (userKey(d) !== u.name) return send(res, 400, { error: 'Beim Namen lässt sich nur die Groß- und Kleinschreibung ändern. Für einen anderen Namen lege ein neues Konto an.' });
        if (d !== dispName(u)) uch.push('Name: ' + dispName(u) + ' → ' + d);
        u.display = d;
      }
      if ('sid' in b) { const ns = cleanSid(b.sid, u); if (ns !== u.sid) uch.push('Schatten ID: ' + (u.sid || '-') + ' → ' + ns); u.sid = ns; }
      if ('role' in b && u.name !== MAIN) {
        if (!db.roles[b.role]) return send(res, 400, { error: 'Ungültige Rolle.' });
        if (b.role === 'owner' && me.name !== MAIN) return send(res, 403, { error: 'Schatten-Leitungs-Konten legt nur das Haupt-Owner-Konto an.' });
        if (!canAssign(me, b.role)) return send(res, 403, { error: 'Du kannst nur Gruppen vergeben, deren Rechte du selbst hast.' });
        if (b.role !== u.role) uch.push('Gruppe: ' + ((db.roles[u.role] || {}).label || u.role) + ' → ' + ((db.roles[b.role] || {}).label || b.role));
        u.role = b.role;
      }
      if ('until' in b && u.name !== MAIN) {
        if (!b.until) { if (u.expires) { delete u.expires; uch.push('unbefristet'); } }
        else {
          if (u.role === 'owner' || b.role === 'owner') return send(res, 400, { error: 'Schatten-Leitungs-Konten können nicht befristet werden.' });
          u.expires = cleanUntil(b.until); uch.push('befristet bis ' + untilTxt(u.expires));
        }
      }
      if ('blocked' in b && u.name !== MAIN) {
        const nb = !!b.blocked;
        if (nb && u.name === me.name) return send(res, 400, { error: 'Du kannst dein eigenes Konto nicht sperren.' });
        if (nb !== !!u.blocked) { if (nb) { u.blocked = true; u.since = Date.now(); } else delete u.blocked; uch.push(nb ? 'gesperrt' : 'entsperrt'); }
      }
      if ('inv' in b) {
        if (me.role !== 'owner') return send(res, 403, { error: 'Die Ermittler-Freigabe vergibt nur die Schatten Leitung.' });
        const ni = !!b.inv;
        if (ni && u.ris) return send(res, 400, { error: 'RIS-Konten können keine Jedi Ermittler sein.' });
        if (ni !== !!u.inv) { if (ni) u.inv = true; else delete u.inv; uch.push(ni ? 'Jedi Ermittler freigegeben' : 'Ermittler-Freigabe entzogen'); }
      }
      let pw = null;
      if (b.reset === true && u.name !== MAIN) { pw = genPassword(); u.hash = hashPw(pw); u.since = Date.now(); u.mustChange = true; uch.push('neues Passwort erzeugt'); }
      if (uch.length) logAct(me, 'Konto geändert', dispName(u) + ': ' + uch.join(', '));
      save();
      return send(res, 200, { ok: true, username: dispName(u), password: pw });
    }
    if (method === 'DELETE') { logAct(me, 'Konto gelöscht', dispName(u) + ' (' + (u.sid || '-') + ')'); delete db.users[key]; save(); return send(res, 200, { ok: true }); }
  }
  return send(res, 404, { error: 'Nicht gefunden.' });
}

const server = http.createServer(function (req, res) {
  headers(res);
  const url = new URL(req.url, 'http://x');
  if (url.pathname.indexOf('/api/') === 0) {
    api(req, res, url).catch(function (e) {
      if (!e.status) console.error('API-Fehler bei ' + req.method + ' ' + url.pathname + ':', e && e.stack || e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Serverfehler (' + String(e && e.message || e).slice(0, 160) + ').' });
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

remotePull().then(function () {
  load();
  server.listen(PORT, '0.0.0.0', function () {
    console.log('Wächter Datenbank läuft auf Port ' + PORT + ' (Daten: ' + DATA_DIR + (REMOTE ? ', Dauerspeicher aktiv' : ', FLÜCHTIG: ohne Dauerspeicher gehen Änderungen beim Neustart verloren') + ')');
  });
});
