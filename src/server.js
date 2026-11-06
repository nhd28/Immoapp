import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, logActivity } from './db.js';
import { STATUSES, STATUS_KEYS, CRITERIA, statusLabel } from './statuses.js';
import { aiEnabled, analyzeProperty } from './ai.js';

const PORT = Number(process.env.PORT) || 3000;
const USERS = (process.env.APP_USERS || 'Ich,Matthias').split(',').map((s) => s.trim()).filter(Boolean);
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.APP_SECRET || crypto.createHash('sha256').update(`immo:${PASSWORD}`).digest('hex');

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---------- Login (gemeinsames Passwort + Name) ----------
const sign = (name) => crypto.createHmac('sha256', SECRET).update(name).digest('hex');
const makeToken = (name) => `${Buffer.from(name).toString('base64url')}.${sign(name)}`;
function readUser(req) {
  const m = /(?:^|;\s*)immo_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [b64, sig] = m[1].split('.');
  if (!b64 || !sig) return null;
  const name = Buffer.from(b64, 'base64url').toString();
  const expected = sign(name);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return name;
}

app.get('/healthz', (req, res) => res.type('text').send('ok'));

app.get('/api/config', (req, res) => {
  res.json({ users: USERS, passwordRequired: Boolean(PASSWORD), user: readUser(req), statuses: STATUSES, criteria: CRITERIA, aiEnabled: aiEnabled() });
});

app.post('/api/login', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Bitte Namen angeben' });
  if (PASSWORD) {
    const a = Buffer.from(String(req.body?.password || ''));
    const b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Falsches Passwort' });
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `immo_session=${makeToken(name)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
  res.json({ user: name });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'immo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

const requireUser = (req, res, next) => {
  req.user = readUser(req);
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
};
app.use('/api', requireUser);
// Signierte, zeitlich begrenzte Datei-Links – für die native App, die PDFs im System-Viewer
// (ohne Session-Cookie) öffnet.
const FILE_LINK_TTL = 24 * 3600;
const fileSig = (name, exp) => crypto.createHmac('sha256', SECRET).update(`file:${name}:${exp}`).digest('hex');
function signedFileUrl(name) {
  const exp = Math.floor(Date.now() / 1000) + FILE_LINK_TTL;
  return `/files/${name}?exp=${exp}&sig=${fileSig(name, exp)}`;
}
function fileAccess(req, res, next) {
  const { exp, sig } = req.query;
  if (sig && exp && Number(exp) > Date.now() / 1000) {
    const expected = fileSig(decodeURIComponent(req.path.slice(1)), exp);
    if (String(sig).length === expected.length && crypto.timingSafeEqual(Buffer.from(String(sig)), Buffer.from(expected))) return next();
  }
  return requireUser(req, res, next);
}
app.use('/files', fileAccess, express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));

// ---------- Uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase().slice(0, 10)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 40 },
});
// multer liefert Dateinamen als latin1 – für Umlaute nach UTF-8 umwandeln
const fixName = (n) => Buffer.from(n, 'latin1').toString('utf8');

function saveFiles(propertyId, files, user, forcedKind) {
  const insert = db.prepare('INSERT INTO files (property_id, kind, stored_name, original_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const saved = [];
  for (const f of files) {
    const kind = forcedKind || (f.mimetype.startsWith('image/') ? 'image' : f.mimetype === 'application/pdf' ? 'expose' : 'doc');
    insert.run(propertyId, kind, f.filename, fixName(f.originalname), f.mimetype, f.size, user);
    saved.push({ kind, name: fixName(f.originalname) });
  }
  // erstes Bild automatisch als Titelbild
  const hasCover = db.prepare("SELECT 1 FROM files WHERE property_id = ? AND kind = 'image' AND is_cover = 1").get(propertyId);
  if (!hasCover) db.prepare("UPDATE files SET is_cover = 1 WHERE id = (SELECT id FROM files WHERE property_id = ? AND kind = 'image' ORDER BY id LIMIT 1)").run(propertyId);
  if (saved.length) logActivity(propertyId, user, 'upload', `${saved.length} Datei(en) hochgeladen: ${saved.map((s) => s.name).join(', ')}`);
  return saved;
}

// ---------- Hilfen ----------
const FIELDS = ['title', 'address', 'city', 'type', 'price', 'living_area', 'plot_area', 'rooms', 'units', 'year_built', 'rent_yearly', 'hausgeld', 'energy_class', 'source', 'link', 'contact', 'notes'];
const NUMERIC = new Set(['price', 'living_area', 'plot_area', 'rooms', 'units', 'year_built', 'rent_yearly', 'hausgeld']);
function cleanFields(body) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in body)) continue;
    let v = body[k];
    if (NUMERIC.has(k)) {
      if (v === '' || v == null) v = null;
      else {
        v = Number(String(v).replace(/\./g, '').replace(',', '.'));
        if (!Number.isFinite(v)) v = null;
      }
    } else v = v == null ? null : String(v).slice(0, 5000);
    out[k] = v;
  }
  return out;
}

function ratingSummary(propertyId) {
  const rows = db.prepare('SELECT * FROM ratings WHERE property_id = ?').all(propertyId);
  const ratings = rows.map((r) => {
    const scores = JSON.parse(r.scores || '{}');
    const vals = Object.values(scores).filter((v) => v >= 1 && v <= 5);
    return { user: r.user, scores, verdict: r.verdict, comment: r.comment, updated_at: r.updated_at, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
  const avgs = ratings.map((r) => r.avg).filter((v) => v != null);
  return { ratings, avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null };
}

function listItem(p) {
  const cover = db.prepare("SELECT stored_name FROM files WHERE property_id = ? AND kind = 'image' ORDER BY is_cover DESC, id LIMIT 1").get(p.id);
  const counts = db.prepare("SELECT SUM(kind = 'image') AS images, SUM(kind = 'expose') AS exposes FROM files WHERE property_id = ?").get(p.id);
  const { ratings, avg } = ratingSummary(p.id);
  const ai = p.ai_analysis ? JSON.parse(p.ai_analysis) : null;
  return {
    id: p.id, title: p.title, city: p.city, address: p.address, type: p.type, price: p.price, living_area: p.living_area,
    rooms: p.rooms, rent_yearly: p.rent_yearly, status: p.status, created_by: p.created_by, created_at: p.created_at, updated_at: p.updated_at,
    cover: cover ? `/files/${cover.stored_name}` : null, images: counts.images || 0, exposes: counts.exposes || 0,
    rating_avg: avg, verdicts: ratings.map((r) => ({ user: r.user, verdict: r.verdict, avg: r.avg })),
    ai_status: p.ai_status, ai_score: ai?.assessment?.score ?? null,
  };
}

function fullProperty(id) {
  const p = db.prepare('SELECT * FROM properties WHERE id = ?').get(id);
  if (!p) return null;
  const files = db.prepare('SELECT * FROM files WHERE property_id = ? ORDER BY is_cover DESC, id').all(id)
    .map((f) => ({ ...f, url: `/files/${f.stored_name}`, signed_url: signedFileUrl(f.stored_name) }));
  const activity = db.prepare('SELECT * FROM activity WHERE property_id = ? ORDER BY id DESC LIMIT 200').all(id);
  return { ...p, ai_analysis: p.ai_analysis ? JSON.parse(p.ai_analysis) : null, files, activity, ...ratingSummary(id) };
}

const getId = (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM properties WHERE id = ?').get(id)) {
    res.status(404).json({ error: 'Immobilie nicht gefunden' });
    return null;
  }
  return id;
};

function startAnalysis(id, user) {
  analyzeProperty(id, user).catch((err) => console.error(`KI-Analyse #${id} fehlgeschlagen:`, err.message));
}

// ---------- API ----------
app.get('/api/properties', (req, res) => {
  res.json(db.prepare('SELECT * FROM properties ORDER BY updated_at DESC').all().map(listItem));
});

app.post('/api/properties', upload.array('files'), (req, res) => {
  const fields = cleanFields(req.body || {});
  const files = req.files || [];
  if (!fields.title) {
    const firstPdf = files.find((f) => f.mimetype === 'application/pdf');
    fields.title = firstPdf ? `Neues Exposé – ${fixName(firstPdf.originalname).replace(/\.pdf$/i, '')}` : 'Neues Exposé';
  }
  const cols = Object.keys(fields);
  const { lastInsertRowid } = db.prepare(
    `INSERT INTO properties (${cols.join(', ')}, status, created_by) VALUES (${cols.map(() => '?').join(', ')}, 'eingang', ?)`,
  ).run(...cols.map((c) => fields[c]), req.user);
  const id = Number(lastInsertRowid);
  logActivity(id, req.user, 'created', 'Immobilie angelegt (Eingang)');
  saveFiles(id, files, req.user);
  const autoAnalyze = req.body?.analyze !== 'false' && aiEnabled() && files.some((f) => f.mimetype === 'application/pdf');
  if (autoAnalyze) {
    db.prepare("UPDATE properties SET ai_status = 'running' WHERE id = ?").run(id);
    startAnalysis(id, req.user);
  }
  res.status(201).json(fullProperty(id));
});

app.get('/api/properties/:id', (req, res) => {
  const id = getId(req, res);
  if (id != null) res.json(fullProperty(id));
});

app.patch('/api/properties/:id', (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  const fields = cleanFields(req.body || {});
  if ('title' in fields && !fields.title) return res.status(400).json({ error: 'Titel darf nicht leer sein' });
  const cols = Object.keys(fields);
  if (cols.length) {
    db.prepare(`UPDATE properties SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...cols.map((c) => fields[c]), id);
  }
  res.json(fullProperty(id));
});

app.put('/api/properties/:id/status', (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  const status = req.body?.status;
  if (!STATUS_KEYS.includes(status)) return res.status(400).json({ error: 'Unbekannter Status' });
  const old = db.prepare('SELECT status FROM properties WHERE id = ?').get(id).status;
  if (old !== status) {
    db.prepare("UPDATE properties SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    const note = req.body?.note ? ` – ${String(req.body.note).slice(0, 500)}` : '';
    logActivity(id, req.user, 'status', `Status: ${statusLabel(old)} → ${statusLabel(status)}${note}`);
  }
  res.json(fullProperty(id));
});

app.delete('/api/properties/:id', (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  const files = db.prepare('SELECT stored_name FROM files WHERE property_id = ?').all(id);
  db.prepare('DELETE FROM properties WHERE id = ?').run(id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

app.post('/api/properties/:id/files', upload.array('files'), (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  const kind = ['expose', 'image', 'doc'].includes(req.body?.kind) ? req.body.kind : undefined;
  saveFiles(id, req.files || [], req.user, kind);
  db.prepare("UPDATE properties SET updated_at = datetime('now') WHERE id = ?").run(id);
  res.json(fullProperty(id));
});

app.patch('/api/files/:fileId', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'Datei nicht gefunden' });
  if (req.body?.is_cover) {
    db.prepare('UPDATE files SET is_cover = 0 WHERE property_id = ?').run(f.property_id);
    db.prepare('UPDATE files SET is_cover = 1 WHERE id = ?').run(f.id);
  }
  if (['expose', 'image', 'doc'].includes(req.body?.kind)) db.prepare('UPDATE files SET kind = ? WHERE id = ?').run(req.body.kind, f.id);
  res.json(fullProperty(f.property_id));
});

app.delete('/api/files/:fileId', (req, res) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(Number(req.params.fileId));
  if (!f) return res.status(404).json({ error: 'Datei nicht gefunden' });
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  fs.rm(path.join(UPLOAD_DIR, f.stored_name), { force: true }, () => {});
  res.json(fullProperty(f.property_id));
});

app.put('/api/properties/:id/rating', (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  const scores = {};
  for (const c of CRITERIA) {
    const v = Number(req.body?.scores?.[c.key]);
    if (v >= 1 && v <= 5) scores[c.key] = Math.round(v);
  }
  const verdict = ['ja', 'vielleicht', 'nein'].includes(req.body?.verdict) ? req.body.verdict : null;
  const comment = req.body?.comment ? String(req.body.comment).slice(0, 5000) : null;
  db.prepare(`INSERT INTO ratings (property_id, user, scores, verdict, comment, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(property_id, user) DO UPDATE SET scores = excluded.scores, verdict = excluded.verdict, comment = excluded.comment, updated_at = excluded.updated_at`)
    .run(id, req.user, JSON.stringify(scores), verdict, comment);
  db.prepare("UPDATE properties SET updated_at = datetime('now') WHERE id = ?").run(id);
  res.json(fullProperty(id));
});

app.post('/api/properties/:id/comments', (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  const text = String(req.body?.text || '').trim().slice(0, 5000);
  if (!text) return res.status(400).json({ error: 'Kommentar ist leer' });
  logActivity(id, req.user, 'comment', text);
  res.json(fullProperty(id));
});

app.post('/api/properties/:id/analyze', (req, res) => {
  const id = getId(req, res);
  if (id == null) return;
  if (!aiEnabled()) return res.status(400).json({ error: 'KI-Analyse ist nicht konfiguriert (ANTHROPIC_API_KEY fehlt)' });
  if (!db.prepare("SELECT 1 FROM files WHERE property_id = ? AND kind = 'expose' AND mime = 'application/pdf'").get(id)) {
    return res.status(400).json({ error: 'Bitte zuerst ein Exposé als PDF hochladen' });
  }
  db.prepare("UPDATE properties SET ai_status = 'running', ai_error = NULL WHERE id = ?").run(id);
  startAnalysis(id, req.user);
  res.status(202).json(fullProperty(id));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload-Fehler: ${err.message}` });
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler' });
});

// ---------- Frontend ----------
app.use(express.static(path.resolve('public')));
app.get(/^\/(?!api|files).*/, (req, res) => res.sendFile(path.resolve('public/index.html')));

// Hängengebliebene Analysen nach Neustart zurücksetzen
db.prepare("UPDATE properties SET ai_status = 'error', ai_error = 'Analyse durch Neustart unterbrochen' WHERE ai_status = 'running'").run();

app.listen(PORT, () => {
  console.log(`Immo-App läuft auf http://localhost:${PORT}`);
  console.log(`Nutzer: ${USERS.join(', ')} · Passwort: ${PASSWORD ? 'aktiv' : 'AUS (APP_PASSWORD setzen!)'} · KI: ${aiEnabled() ? 'aktiv' : 'aus'}`);
});
