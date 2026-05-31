const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const { Users, Appointments, Blocked } = require('./db');
const { log, requestLogger } = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'glow-secret-key-change-in-prod';

// ─── Middleware ───────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(requestLogger); // Audit log — каждый запрос
app.use(express.static(path.join(__dirname, '../frontend')));

const limiter     = rateLimit({ windowMs: 15*60*1000, max: 200, message: { error: 'Слишком много запросов' } });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 15,  message: { error: 'Слишком много попыток входа' } });
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ─── Helpers ──────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Не авторизован' });
  try { req.user = jwt.verify(auth.slice(7), JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Токен недействителен' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

// Проверка конфликта слотов с учётом длительности
function hasConflict(masterId, date, time, durationMins, excludeId = null) {
  function toMins(t) { const [h, m] = t.split(':').map(Number); return h*60+m; }
  const newStart = toMins(time);
  const newEnd   = newStart + durationMins;

  // Проверяем существующие брони
  const existing = Appointments.occupiedChunks(masterId, date, excludeId);
  for (const { time: t, duration_mins: dur } of existing) {
    const s = toMins(t), e = s + dur;
    if (newStart < e && newEnd > s) return true; // пересечение
  }
  // Проверяем заблокированные слоты
  const blocked = Blocked.forMasterDate(masterId, date);
  for (const bt of blocked) {
    const bm = toMins(bt);
    if (bm >= newStart && bm < newEnd) return true;
  }
  return false;
}

// ─── AUTH ─────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role = 'client' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    if (Users.findByEmail(email)) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hashed = await bcrypt.hash(password, 10);
    const safeRole = ['client','master'].includes(role) ? role : 'client';
    const info = Users.create({ name, email, password: hashed, role: safeRole });
    const user = Users.findById(info.lastInsertRowid);
    log('REGISTER', { newUserId: user.id, email, role: safeRole }, req);
    res.status(201).json({ token: generateToken(user), user: Users.safe(user) });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Введите email и пароль' });
    const user = Users.findByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      log('LOGIN_FAIL', { email }, req);
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    log('LOGIN', { userId: user.id, email, role: user.role }, req);
    res.json({ token: generateToken(user), user: Users.safe(user) });
  } catch (e) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = Users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(Users.safe(user));
});

// ─── APPOINTMENTS ─────────────────────────────────────────────────
app.get('/api/appointments', authMiddleware, (req, res) => {
  const { masterId, date, status } = req.query;
  const filter = { date, status };
  if (masterId) filter.masterId = parseInt(masterId);
  // клиент видит только свои
  if (req.user.role === 'client') filter.userId = req.user.id;
  res.json(Appointments.all(filter));
});

app.post('/api/appointments', authMiddleware, (req, res) => {
  const { masterId, masterName, service, date, time, durationMins,
          clientName, clientPhone, comment, payMethod, discount } = req.body;
  if (!masterId || !date || !time) return res.status(400).json({ error: 'Укажите мастера, дату и время' });

  const dur = durationMins || 60;
  if (hasConflict(parseInt(masterId), date, time, dur))
    return res.status(409).json({ error: 'Это время уже занято — выберите другое' });

  const info = Appointments.create({
    userId: req.user.id, masterId: parseInt(masterId), masterName, service,
    date, time, durationMins: dur, clientName: clientName || req.user.name,
    clientPhone, comment, payMethod, discount,
    createdByAdmin: req.user.role === 'admin',
  });
  const created = Appointments.findById(info.lastInsertRowid);
  log('BOOKING_CREATE', { appointmentId: created.id, masterId, date, time }, req);
  res.status(201).json(created);
});

app.patch('/api/appointments/:id', authMiddleware, (req, res) => {
  const apt = Appointments.findById(parseInt(req.params.id));
  if (!apt) return res.status(404).json({ error: 'Запись не найдена' });
  if (req.user.role !== 'admin' && apt.user_id !== req.user.id)
    return res.status(403).json({ error: 'Нет доступа' });

  const { date, time, status } = req.body;

  // Проверяем конфликт при переносе
  if ((date || time) && status !== 'cancelled') {
    const newDate = date || apt.date;
    const newTime = time || apt.time;
    if (hasConflict(apt.master_id, newDate, newTime, apt.duration_mins, apt.id))
      return res.status(409).json({ error: 'Выбранное время уже занято' });
  }

  Appointments.update(apt.id, { date, time, status: status || (date || time ? 'moved' : undefined) });
  res.json(Appointments.findById(apt.id));
});

app.delete('/api/appointments/:id', authMiddleware, (req, res) => {
  const apt = Appointments.findById(parseInt(req.params.id));
  if (!apt) return res.status(404).json({ error: 'Запись не найдена' });
  if (req.user.role !== 'admin' && apt.user_id !== req.user.id)
    return res.status(403).json({ error: 'Нет доступа' });
  Appointments.cancel(apt.id);
  res.json({ ok: true });
});

// ─── BLOCKED SLOTS ────────────────────────────────────────────────
app.get('/api/blocked', (req, res) => {
  const { masterId, date } = req.query;
  if (masterId && date) return res.json(Blocked.forMasterDate(parseInt(masterId), date));
  res.json(Blocked.all());
});

app.post('/api/blocked', authMiddleware, adminOnly, (req, res) => {
  const { masterId, date, time } = req.body;
  if (!masterId || !date || !time) return res.status(400).json({ error: 'Укажите мастера, дату и время' });
  Blocked.add(parseInt(masterId), date, time);
  res.json({ ok: true });
});

app.delete('/api/blocked', authMiddleware, adminOnly, (req, res) => {
  const { masterId, date, time } = req.body;
  if (!masterId || !date || !time) return res.status(400).json({ error: 'Укажите мастера, дату и время' });
  Blocked.remove(parseInt(masterId), date, time);
  res.json({ ok: true });
});

// ─── ADMIN ────────────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  res.json(Users.all());
});

app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  res.json({ ...Appointments.stats(), masters: 6, users: Users.all().length });
});

// ─── MASTERS (публичные данные) ───────────────────────────────────
const MASTERS = [
  { id:1, name:'Анна Соколова',   specialty:'Мастер маникюра', rating:4.9, reviews:127, price:'от 1500 ₽', experience:'5 лет',  duration:150, category:'manicure' },
  { id:2, name:'Мария Иванова',   specialty:'Бровист',          rating:4.8, reviews:89,  price:'от 2000 ₽', experience:'3 года', duration:60,  category:'brows'    },
  { id:3, name:'Елена Козлова',   specialty:'Визажист',          rating:5.0, reviews:203, price:'от 3000 ₽', experience:'7 лет',  duration:90,  category:'makeup'   },
  { id:4, name:'Ольга Петрова',   specialty:'Мастер по волосам', rating:4.7, reviews:156, price:'от 2500 ₽', experience:'6 лет',  duration:120, category:'hair'     },
  { id:5, name:'Наталья Сидорова',specialty:'Косметолог',        rating:4.9, reviews:94,  price:'от 3500 ₽', experience:'8 лет',  duration:90,  category:'skin'     },
  { id:6, name:'Юлия Новикова',   specialty:'Лэшмейкер',         rating:4.8, reviews:112, price:'от 2200 ₽', experience:'4 года', duration:90,  category:'lash'     },
];

app.get('/api/masters', (req, res) => {
  const { category } = req.query;
  const list = category && category !== 'all' ? MASTERS.filter(m => m.category === category) : MASTERS;
  res.json(list);
});

app.get('/api/masters/:id', (req, res) => {
  const m = MASTERS.find(x => x.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: 'Мастер не найден' });
  const stats = Appointments.stats();
  res.json({ ...m, totalBookings: stats.active });
});

// ─── SPA Fallback ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Маршрут не найден' });
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✨ GLOW сервер: http://localhost:${PORT}`);
  console.log(`   БД: ${require('path').join(__dirname, 'glow.db')}`);
  console.log(`   Логины: admin@glow.com/admin123 · client@glow.com/client123`);
});
