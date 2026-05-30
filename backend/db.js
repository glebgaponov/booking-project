/**
 * GLOW — SQLite database layer
 * Файл БД: backend/glow.db (создаётся автоматически при первом запуске)
 */

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'glow.db');
const db = new Database(DB_PATH);

// ─── Pragma ───────────────────────────────────────────────────────
db.pragma('journal_mode = WAL');   // лучшая производительность
db.pragma('foreign_keys = ON');    // каскадные удаления

// ─── Схема ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'client' CHECK(role IN ('client','master','admin')),
    bio         TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    master_id       INTEGER NOT NULL,
    master_name     TEXT    NOT NULL,
    service         TEXT,
    date            TEXT    NOT NULL,
    time            TEXT    NOT NULL,
    duration_mins   INTEGER NOT NULL DEFAULT 60,
    client_name     TEXT,
    client_phone    TEXT,
    comment         TEXT,
    pay_method      TEXT    DEFAULT 'cash',
    discount        INTEGER DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','moved','cancelled')),
    created_by_admin INTEGER DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT
  );

  CREATE TABLE IF NOT EXISTS blocked_slots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    master_id  INTEGER NOT NULL,
    date       TEXT    NOT NULL,
    time       TEXT    NOT NULL,
    UNIQUE(master_id, date, time)
  );

  CREATE INDEX IF NOT EXISTS idx_apt_master_date ON appointments(master_id, date);
  CREATE INDEX IF NOT EXISTS idx_apt_user       ON appointments(user_id);
  CREATE INDEX IF NOT EXISTS idx_blocked        ON blocked_slots(master_id, date);
`);

// ─── Seed: demo-пользователи ──────────────────────────────────────
function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (count > 0) return;

  const insert = db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  );
  const demos = [
    ['Admin GLOW',    'admin@glow.com',  bcrypt.hashSync('admin123',  10), 'admin'],
    ['Мария Клиент',  'client@glow.com', bcrypt.hashSync('client123', 10), 'client'],
    ['Анна Мастер',   'master@glow.com', bcrypt.hashSync('master123', 10), 'master'],
  ];
  const insertMany = db.transaction(rows => rows.forEach(r => insert.run(...r)));
  insertMany(demos);
  console.log('✅ Demo-пользователи добавлены в БД');
}
seedUsers();

// ─── USERS ────────────────────────────────────────────────────────
const Users = {
  findByEmail: email =>
    db.prepare('SELECT * FROM users WHERE email = ?').get(email),

  findById: id =>
    db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  create: ({ name, email, password, role = 'client' }) =>
    db.prepare(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
    ).run(name, email, password, role),

  all: () =>
    db.prepare('SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC').all(),

  safe: user => {
    if (!user) return null;
    const { password: _, ...safe } = user;
    return { ...safe, createdAt: user.created_at };
  },
};

// ─── APPOINTMENTS ─────────────────────────────────────────────────
const Appointments = {
  all: ({ masterId, userId, date, status } = {}) => {
    let sql = 'SELECT * FROM appointments WHERE 1=1';
    const params = [];
    if (masterId) { sql += ' AND master_id = ?'; params.push(masterId); }
    if (userId)   { sql += ' AND user_id = ?';   params.push(userId); }
    if (date)     { sql += ' AND date = ?';       params.push(date); }
    if (status)   { sql += ' AND status = ?';     params.push(status); }
    sql += ' ORDER BY date DESC, time DESC';
    return db.prepare(sql).all(...params);
  },

  findById: id =>
    db.prepare('SELECT * FROM appointments WHERE id = ?').get(id),

  create: ({
    userId, masterId, masterName, service, date, time, durationMins,
    clientName, clientPhone, comment, payMethod, discount, createdByAdmin
  }) =>
    db.prepare(`
      INSERT INTO appointments
        (user_id, master_id, master_name, service, date, time, duration_mins,
         client_name, client_phone, comment, pay_method, discount, created_by_admin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId || null, masterId, masterName, service, date, time, durationMins || 60,
      clientName, clientPhone, comment, payMethod || 'cash', discount || 0,
      createdByAdmin ? 1 : 0
    ),

  update: (id, { date, time, status }) => {
    const sets = [], params = [];
    if (date)   { sets.push('date = ?');   params.push(date); }
    if (time)   { sets.push('time = ?');   params.push(time); }
    if (status) { sets.push('status = ?'); params.push(status); }
    sets.push("updated_at = datetime('now')");
    params.push(id);
    return db.prepare(`UPDATE appointments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  },

  cancel: id =>
    db.prepare("UPDATE appointments SET status='cancelled', updated_at=datetime('now') WHERE id=?").run(id),

  stats: () => ({
    total:     db.prepare("SELECT COUNT(*) as n FROM appointments").get().n,
    active:    db.prepare("SELECT COUNT(*) as n FROM appointments WHERE status IN ('confirmed','moved')").get().n,
    cancelled: db.prepare("SELECT COUNT(*) as n FROM appointments WHERE status='cancelled'").get().n,
  }),

  // Занятые 30-минутные чанки для мастера на дату (для проверки конфликтов)
  occupiedChunks: (masterId, date, excludeId = null) => {
    let sql = "SELECT time, duration_mins FROM appointments WHERE master_id=? AND date=? AND status!='cancelled'";
    const params = [masterId, date];
    if (excludeId) { sql += ' AND id!=?'; params.push(excludeId); }
    return db.prepare(sql).all(...params);
  },
};

// ─── BLOCKED SLOTS ────────────────────────────────────────────────
const Blocked = {
  forMasterDate: (masterId, date) =>
    db.prepare('SELECT time FROM blocked_slots WHERE master_id=? AND date=? ORDER BY time')
      .all(masterId, date).map(r => r.time),

  all: () => {
    const rows = db.prepare('SELECT master_id, date, time FROM blocked_slots').all();
    const out = {};
    rows.forEach(({ master_id, date, time }) => {
      if (!out[master_id]) out[master_id] = {};
      if (!out[master_id][date]) out[master_id][date] = [];
      out[master_id][date].push(time);
    });
    return out;
  },

  add: (masterId, date, time) =>
    db.prepare('INSERT OR IGNORE INTO blocked_slots (master_id, date, time) VALUES (?,?,?)').run(masterId, date, time),

  remove: (masterId, date, time) =>
    db.prepare('DELETE FROM blocked_slots WHERE master_id=? AND date=? AND time=?').run(masterId, date, time),
};

// ─── Utility: сброс БД ────────────────────────────────────────────
function resetDb() {
  db.exec('DELETE FROM blocked_slots; DELETE FROM appointments; DELETE FROM users;');
  db.exec("DELETE FROM sqlite_sequence WHERE name IN ('users','appointments','blocked_slots')");
  seedUsers();
  console.log('🔄 БД сброшена и пересоздана');
}

module.exports = { db, Users, Appointments, Blocked, resetDb };
