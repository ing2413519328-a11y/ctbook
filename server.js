const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.db');
const PORT = 3000;

// --- Database setup ---
let db;
function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      source TEXT DEFAULT '',
      error_reason TEXT DEFAULT '',
      screenshot TEXT DEFAULT '',
      answer_image TEXT DEFAULT '',
      answer_images TEXT DEFAULT '[]',
      answer_text TEXT DEFAULT '',
      hint TEXT DEFAULT '',
      hint_images TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      correct INTEGER NOT NULL,
      reviewed_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_entry_id ON reviews(entry_id);
  `);
}

// --- Server ---
initDb();

const app = express();
app.use(express.json({ limit: '100mb' }));

// Serve static files
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// --- API Routes ---

// Subjects
app.get('/api/subjects', (req, res) => {
  const rows = db.prepare('SELECT name FROM subjects ORDER BY name ASC').all();
  res.json(rows);
});

app.post('/api/subjects', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    db.prepare('INSERT INTO subjects (name) VALUES (?)').run(name);
    res.status(201).json({ name });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '科目已存在' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/subjects/:name', (req, res) => {
  const name = req.params.name;
  db.prepare('DELETE FROM reviews WHERE entry_id IN (SELECT id FROM entries WHERE subject = ?)').run(name);
  db.prepare('DELETE FROM entries WHERE subject = ?').run(name);
  db.prepare('DELETE FROM subjects WHERE name = ?').run(name);
  res.json({ ok: true });
});

// Sources
app.get('/api/sources', (req, res) => {
  const rows = db.prepare('SELECT name FROM sources ORDER BY name ASC').all();
  res.json(rows);
});

app.post('/api/sources', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    db.prepare('INSERT INTO sources (name) VALUES (?)').run(name);
    res.status(201).json({ name });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: '来源已存在' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/sources/:name', (req, res) => {
  const name = req.params.name;
  db.prepare('DELETE FROM reviews WHERE entry_id IN (SELECT id FROM entries WHERE source = ?)').run(name);
  db.prepare('DELETE FROM entries WHERE source = ?').run(name);
  db.prepare('DELETE FROM sources WHERE name = ?').run(name);
  res.json({ ok: true });
});

// Entries
app.get('/api/entries', (req, res) => {
  const { subject, fields, id_in } = req.query;
  let sql = 'SELECT id, subject, source, error_reason, created_at FROM entries';
  if (fields === 'id,screenshot') {
    sql = 'SELECT id, screenshot FROM entries';
  }
  let where = [];
  let params = [];
  if (subject) {
    where.push('subject = ?');
    params.push(subject);
  }
  if (id_in) {
    const ids = id_in.split(',').map(Number).filter(n => !isNaN(n));
    if (ids.length > 0) {
      where.push(`id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
  }
  if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

app.get('/api/entries/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  // Parse JSON string fields to arrays
  if (typeof row.answer_images === 'string') row.answer_images = JSON.parse(row.answer_images);
  if (typeof row.hint_images === 'string') row.hint_images = JSON.parse(row.hint_images);
  res.json([row]); // match Supabase format: array with one element
});

app.post('/api/entries', (req, res) => {
  const { subject, source, error_reason, screenshot, answer_image, answer_images, answer_text, hint, hint_images, created_at } = req.body;
  if (!subject) return res.status(400).json({ error: 'subject required' });
  const result = db.prepare(`
    INSERT INTO entries (subject, source, error_reason, screenshot, answer_image, answer_images, answer_text, hint, hint_images, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    subject, source || '', error_reason || '', screenshot || '',
    answer_image || '', JSON.stringify(answer_images || []), answer_text || '',
    hint || '', JSON.stringify(hint_images || []), created_at || new Date().toISOString()
  );
  res.status(201).json([{ id: result.lastInsertRowid }]);
});

app.patch('/api/entries/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const updates = req.body;
  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    // Map camelCase from frontend to snake_case DB columns
    const col = key === 'errorReason' ? 'error_reason'
      : key === 'answerImage' ? 'answer_image'
      : key === 'answerImages' ? 'answer_images'
      : key === 'answerText' ? 'answer_text'
      : key === 'hintImages' ? 'hint_images'
      : key;
    fields.push(`${col} = ?`);
    params.push(col === 'answer_images' || col === 'hint_images' ? JSON.stringify(value) : value);
  }

  if (fields.length === 0) return res.json({ ok: true });
  params.push(id);
  db.prepare(`UPDATE entries SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

app.delete('/api/entries/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM reviews WHERE entry_id = ?').run(id);
  db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Reviews
app.get('/api/reviews', (req, res) => {
  const rows = db.prepare('SELECT entry_id, correct FROM reviews').all();
  res.json(rows);
});

app.post('/api/reviews', (req, res) => {
  const { entry_id, correct, reviewed_at } = req.body;
  db.prepare('INSERT INTO reviews (entry_id, correct, reviewed_at) VALUES (?, ?, ?)').run(
    entry_id, correct ? 1 : 0, reviewed_at || new Date().toISOString()
  );
  res.status(201).json({ ok: true });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`\n  📒 错题本已启动`);
  console.log(`  ─────────────────────────────`);
  console.log(`  🌐 打开: http://localhost:${PORT}`);
  console.log(`  📁 数据: ${DB_PATH}`);
  console.log(`  ─────────────────────────────\n`);
});
