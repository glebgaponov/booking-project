const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'glow-secret-key-change-in-prod';

// ─── Middleware ───────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Слишком много запросов, подождите' } });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Слишком много попыток входа' } });
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ─── In-memory DB (замените на PostgreSQL/MongoDB в продакшне) ────
const db = {
  users: [
    { id: 1, name: 'Admin GLOW', email: 'admin@glow.com', password: bcrypt.hashSync('admin123', 10), role: 'admin', createdAt: new Date().toISOString() },
    { id: 2, name: 'Мария Клиент', email: 'client@glow.com', password: bcrypt.hashSync('client123', 10), role: 'client', createdAt: new Date().toISOString() },
    { id: 3, name: 'Анна Мастер', email: 'master@glow.com', password: bcrypt.hashSync('master123', 10), role: 'master', createdAt: new Date().toISOString() },
  ],
  appointments: [],
  blockedSlots: {}, // { masterId: { date: [time,...] } }
  nextUserId: 4,
  nextAppId: 1,
};

// ─── Helpers ──────────────────────────────────────────────────────
function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Не авторизован' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Токен недействителен' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
  next();
}

// ─── AUTH ─────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role = 'client' } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  if (db.users.find(u => u.email === email)) return res.status(409).json({ error: 'Email уже зарегистрирован' });

  const hashed = await bcrypt.hash(password, 10);
  const user = { id: db.nextUserId++, name, email, password: hashed, role: role === 'master' ? 'master' : 'client', createdAt: new Date().toISOString() };
  db.users.push(user);
  const { password: _, ...safe } = user;
  res.status(201).json({ token: generateToken(user), user: safe });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Введите email и пароль' });
  const user = db.users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Неверный email или пароль' });
  const { password: _, ...safe } = user;
  res.json({ token: generateToken(user), user: safe });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ─── APPOINTMENTS ─────────────────────────────────────────────────
app.get('/api/appointments', authMiddleware, (req, res) => {
  const { masterId, date } = req.query;
  let list = db.appointments;
  if (req.user.role === 'client') list = list.filter(a => a.userId === req.user.id);
  if (masterId) list = list.filter(a => a.masterId === parseInt(masterId));
  if (date) list = list.filter(a => a.date === date);
  res.json(list);
});

app.post('/api/appointments', authMiddleware, (req, res) => {
  const { masterId, date, time, service, comment, payMethod, discount, clientName, clientPhone } = req.body;
  if (!masterId || !date || !time) return res.status(400).json({ error: 'Укажите мастера, дату и время' });

  // Check conflicts
  const conflict = db.appointments.find(a =>
    a.masterId === masterId && a.date === date && a.time === time && a.status !== 'cancelled'
  );
  if (conflict) return res.status(409).json({ error: 'Это время уже занято' });

  const apt = {
    id: db.nextAppId++,
    userId: req.user.id,
    masterId, date, time, service, comment, payMethod, discount: discount || 0,
    clientName: clientName || req.user.name,
    clientPhone: clientPhone || '',
    masterName: req.body.masterName || '',
    status: 'confirmed',
    createdByAdmin: req.user.role === 'admin',
    createdAt: new Date().toISOString(),
  };
  db.appointments.unshift(apt);
  res.status(201).json(apt);
});

app.patch('/api/appointments/:id', authMiddleware, (req, res) => {
  const apt = db.appointments.find(a => a.id === parseInt(req.params.id));
  if (!apt) return res.status(404).json({ error: 'Запись не найдена' });
  if (req.user.role !== 'admin' && apt.userId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

  const { date, time, status } = req.body;
  if (date) apt.date = date;
  if (time) apt.time = time;
  if (status) apt.status = status;
  if (date || time) apt.status = 'moved';
  apt.updatedAt = new Date().toISOString();
  res.json(apt);
});

app.delete('/api/appointments/:id', authMiddleware, (req, res) => {
  const idx = db.appointments.findIndex(a => a.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Запись не найдена' });
  if (req.user.role !== 'admin' && db.appointments[idx].userId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  db.appointments[idx].status = 'cancelled';
  res.json({ ok: true });
});

// ─── BLOCKED SLOTS ────────────────────────────────────────────────
app.get('/api/blocked', (req, res) => {
  const { masterId, date } = req.query;
  if (masterId && date) {
    const slots = (db.blockedSlots[masterId] && db.blockedSlots[masterId][date]) || [];
    return res.json(slots);
  }
  res.json(db.blockedSlots);
});

app.post('/api/blocked', authMiddleware, adminOnly, (req, res) => {
  const { masterId, date, time } = req.body;
  if (!masterId || !date || !time) return res.status(400).json({ error: 'Укажите мастера, дату и время' });
  if (!db.blockedSlots[masterId]) db.blockedSlots[masterId] = {};
  if (!db.blockedSlots[masterId][date]) db.blockedSlots[masterId][date] = [];
  if (!db.blockedSlots[masterId][date].includes(time)) db.blockedSlots[masterId][date].push(time);
  res.json({ ok: true });
});

app.delete('/api/blocked', authMiddleware, adminOnly, (req, res) => {
  const { masterId, date, time } = req.body;
  if (!db.blockedSlots[masterId]?.[date]) return res.status(404).json({ error: 'Слот не найден' });
  db.blockedSlots[masterId][date] = db.blockedSlots[masterId][date].filter(t => t !== time);
  res.json({ ok: true });
});

// ─── ADMIN ────────────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, adminOnly, (req, res) => {
  res.json(db.users.map(({ password: _, ...u }) => u));
});

app.get('/api/admin/stats', authMiddleware, adminOnly, (req, res) => {
  const total = db.appointments.length;
  const active = db.appointments.filter(a => a.status === 'confirmed' || a.status === 'moved').length;
  const cancelled = db.appointments.filter(a => a.status === 'cancelled').length;
  res.json({ total, active, cancelled, masters: 6, users: db.users.length });
});

// ─── MASTERS (public) ─────────────────────────────────────────────
const MASTERS = [
  { id: 1, name: 'Анна Соколова', specialty: 'Мастер маникюра', rating: 4.9, reviews: 127, price: 'от 1500 ₽', experience: '5 лет', duration: 150, category: 'manicure' },
  { id: 2, name: 'Мария Иванова', specialty: 'Бровист', rating: 4.8, reviews: 89, price: 'от 2000 ₽', experience: '3 года', duration: 60, category: 'brows' },
  { id: 3, name: 'Елена Козлова', specialty: 'Визажист', rating: 5.0, reviews: 203, price: 'от 3000 ₽', experience: '7 лет', duration: 90, category: 'makeup' },
  { id: 4, name: 'Ольга Петрова', specialty: 'Мастер по волосам', rating: 4.7, reviews: 156, price: 'от 2500 ₽', experience: '6 лет', duration: 120, category: 'hair' },
  { id: 5, name: 'Наталья Сидорова', specialty: 'Косметолог', rating: 4.9, reviews: 94, price: 'от 3500 ₽', experience: '8 лет', duration: 90, category: 'skin' },
  { id: 6, name: 'Юлия Новикова', specialty: 'Лэшмейкер', rating: 4.8, reviews: 112, price: 'от 2200 ₽', experience: '4 года', duration: 90, category: 'lash' },
];

app.get('/api/masters', (req, res) => {
  const { category } = req.query;
  const list = category && category !== 'all' ? MASTERS.filter(m => m.category === category) : MASTERS;
  res.json(list);
});

app.get('/api/masters/:id', (req, res) => {
  const m = MASTERS.find(x => x.id === parseInt(req.params.id));
  if (!m) return res.status(404).json({ error: 'Мастер не найден' });
  const aptCount = db.appointments.filter(a => a.masterId === m.id && a.status !== 'cancelled').length;
  res.json({ ...m, totalBookings: aptCount });
});

// ─── SPA Fallback ─────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Маршрут не найден' });
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Start ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✨ GLOW сервер запущен: http://localhost:${PORT}`);
  console.log(`   Demo: admin@glow.com / admin123`);
  console.log(`         client@glow.com / client123`);
});
