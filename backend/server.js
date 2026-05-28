const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'glow-secret-change-in-production';
const SALT_ROUNDS = 10;

// ─── Безопасность ─────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'images.unsplash.com', 'i.pravatar.cc'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    },
  },
}));

// Rate limiting — общий для всех запросов
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте через 15 минут.' },
});

// Строгий лимит для авторизации (защита от брутфорса)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
});

app.use(generalLimiter);
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── In-memory хранилище ──────────────────────────────────────────────────────
let users = [];
let bookings = [];
let reviews = [];
let nextUserId = 1;
let nextBookingId = 1;

// Создаём администратора при старте (пароль хэшируется)
async function initAdminUser() {
  const hashedPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
  users.push({
    id: nextUserId++,
    fullName: 'Администратор',
    email: 'admin@glow.com',
    password: hashedPassword,
    phone: '',
    role: 'admin',
  });
  console.log('✅ Администратор создан: admin@glow.com / admin123');
}

const mockMasters = [
  { id: 1, name: 'Анна Соловьёва',  category: 'Макияж',  specialization: 'Свадебный визаж',    price: 4500, rating: 4.9, reviews: 128, description: 'Визажист с 7-летним опытом. Работала с известными блогерами и на неделях моды.', photo: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400', portfolio: ['https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=200','https://images.unsplash.com/photo-1512496015851-a90ab38aba96?w=200'] },
  { id: 2, name: 'Елена Морозова',  category: 'Маникюр', specialization: 'Нейл-дизайн',        price: 2500, rating: 4.8, reviews: 94,  description: 'Мастер маникюра с 5-летним стажем. Сложный дизайн, выравнивание.', photo: 'https://images.unsplash.com/photo-1604654894610-df4906b1150c?w=400', portfolio: ['https://images.unsplash.com/photo-1604654894610-df4906b1150c?w=200'] },
  { id: 3, name: 'Мария Волкова',   category: 'Брови',   specialization: 'Архитектура бровей', price: 1800, rating: 5.0, reviews: 56,  description: 'Бровист с медицинским образованием. Коррекция, окрашивание, ламинирование.', photo: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400', portfolio: ['https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=200'] },
  { id: 4, name: 'Ольга Новикова',  category: 'Волосы',  specialization: 'Стилист',            price: 3500, rating: 4.7, reviews: 73,  description: 'Стилист-парикмахер. Стрижки, окрашивание, укладки.', photo: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=400', portfolio: ['https://images.unsplash.com/photo-1562322140-8baeececf3df?w=200'] },
  { id: 5, name: 'Татьяна Белова',  category: 'Макияж',  specialization: 'Вечерний образ',     price: 4000, rating: 4.8, reviews: 45,  description: 'Визажист. Специализация: вечерний и свадебный макияж.', photo: 'https://images.unsplash.com/photo-1512496015851-a90ab38aba96?w=400', portfolio: ['https://images.unsplash.com/photo-1512496015851-a90ab38aba96?w=200'] },
  { id: 6, name: 'Ирина Соколова',  category: 'Уход',    specialization: 'Косметолог',         price: 3000, rating: 4.6, reviews: 38,  description: 'Косметолог. Чистки, уходовые процедуры.', photo: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400', portfolio: ['https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=200'] },
];

// ─── Middleware: проверка JWT ──────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен не предоставлен' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный или истёкший токен' });
  }
}

// ─── Авторизация ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { fullName, email, password, phone, role } = req.body;

    if (!fullName?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Некорректный email' });
    }
    if (users.find(u => u.email === email.toLowerCase())) {
      return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    }

    const allowedRoles = ['client', 'master'];
    const userRole = allowedRoles.includes(role) ? role : 'client';
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = {
      id: nextUserId++,
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      phone: phone?.trim() || '',
      role: userRole,
    };
    users.push(newUser);

    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: userRole, fullName: newUser.fullName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ token, user: { id: newUser.id, fullName: newUser.fullName, email: newUser.email, role: userRole } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });

    const user = users.find(u => u.email === email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, fullName: user.fullName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ id: user.id, fullName: user.fullName, email: user.email, phone: user.phone, role: user.role });
});

// ─── Мастера ──────────────────────────────────────────────────────────────────
app.get('/api/masters', (req, res) => {
  let result = [...mockMasters];
  const { category, maxPrice, minRating, search } = req.query;
  if (search) result = result.filter(m => m.name.toLowerCase().includes(search.toLowerCase()) || m.category.toLowerCase().includes(search.toLowerCase()));
  if (category) result = result.filter(m => m.category.toLowerCase().includes(category.toLowerCase()));
  if (maxPrice) result = result.filter(m => m.price <= parseInt(maxPrice));
  if (minRating) result = result.filter(m => m.rating >= parseFloat(minRating));
  res.json(result);
});

app.get('/api/masters/:id', (req, res) => {
  const master = mockMasters.find(m => m.id === parseInt(req.params.id));
  if (!master) return res.status(404).json({ error: 'Мастер не найден' });
  const masterReviews = reviews.filter(r => r.masterId === master.id);
  res.json({ ...master, reviewsList: masterReviews });
});

// ─── Бронирования ─────────────────────────────────────────────────────────────
app.get('/api/bookings', authMiddleware, (req, res) => {
  const { role, id } = req.user;
  let result = bookings;
  if (role === 'client') result = bookings.filter(b => b.clientId === id);
  else if (role === 'master') {
    const master = mockMasters.find(m => m.email === req.user.email);
    if (master) result = bookings.filter(b => b.masterId === master.id);
  }
  res.json(result);
});

app.post('/api/bookings', authMiddleware, (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Только клиенты могут создавать бронирования' });

  const { masterId, date, time, promoDiscount } = req.body;
  if (!masterId || !date || !time) return res.status(400).json({ error: 'Укажите мастера, дату и время' });

  const dateObj = new Date(date);
  if (isNaN(dateObj) || dateObj < new Date()) return res.status(400).json({ error: 'Укажите корректную будущую дату' });

  const master = mockMasters.find(m => m.id === parseInt(masterId));
  if (!master) return res.status(404).json({ error: 'Мастер не найден' });

  const discount = Math.min(Math.max(parseFloat(promoDiscount) || 0, 0), 100);
  const totalCost = Math.round(master.price * (1 - discount / 100));

  const booking = {
    id: nextBookingId++,
    masterId: master.id, masterName: master.name,
    clientId: req.user.id, clientName: req.user.fullName,
    date, time, totalCost, status: 'pending',
    createdAt: new Date().toISOString(),
  };
  bookings.push(booking);
  res.status(201).json(booking);
});

app.patch('/api/bookings/:id', authMiddleware, (req, res) => {
  const booking = bookings.find(b => b.id === parseInt(req.params.id));
  if (!booking) return res.status(404).json({ error: 'Бронирование не найдено' });

  const allowed = ['confirmed', 'completed', 'cancelled'];
  const { status } = req.body;
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' });

  if (req.user.role === 'client' && booking.clientId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

  booking.status = status;
  res.json(booking);
});

// ─── Отзывы ───────────────────────────────────────────────────────────────────
app.post('/api/reviews', authMiddleware, (req, res) => {
  if (req.user.role !== 'client') return res.status(403).json({ error: 'Только клиенты могут оставлять отзывы' });

  const { masterId, bookingId, rating, text } = req.body;
  if (!masterId || !rating) return res.status(400).json({ error: 'Укажите мастера и оценку' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });

  const existing = reviews.find(r => r.bookingId === bookingId && r.clientId === req.user.id);
  if (existing) return res.status(409).json({ error: 'Вы уже оставили отзыв на эту запись' });

  const review = {
    id: Date.now(), masterId: parseInt(masterId), bookingId,
    clientId: req.user.id, userName: req.user.fullName,
    rating: parseFloat(rating), text: text?.trim() || '',
    createdAt: new Date().toISOString(),
  };
  reviews.push(review);
  res.status(201).json(review);
});

app.get('/api/reviews/:masterId', (req, res) => {
  res.json(reviews.filter(r => r.masterId === parseInt(req.params.masterId)));
});

// ─── Статические страницы ─────────────────────────────────────────────────────
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, '../frontend/about.html')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, '../frontend/robots.txt')));
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, '../frontend/sitemap.xml'));
});
app.get('/sw.js', (req, res) => res.sendFile(path.join(__dirname, '../frontend/sw.js')));

app.get('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../frontend/404.html'));
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
initAdminUser().then(() => {
  app.listen(PORT, () => console.log(`✅ GLOW сервер запущен на http://localhost:${PORT}`));
});