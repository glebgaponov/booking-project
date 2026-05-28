const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'glow-secret-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── In-memory хранилище (замените на PostgreSQL в продакшене) ────────────────
let users = [
  { id: 1, fullName: 'Администратор', email: 'admin@glow.com', password: 'admin123', phone: '', role: 'admin' }
];
let bookings = [];
let reviews = [];
let nextUserId = 2;
let nextBookingId = 1;

const mockMasters = [
  { id: 1, name: 'Анна Соловьёва',  category: 'Макияж',  specialization: 'Свадебный визаж',      price: 4500, rating: 4.9, reviews: 128, description: 'Визажист с 7-летним опытом. Работала с известными блогерами и на неделях моды.', photo: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400', portfolio: ['https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=200','https://images.unsplash.com/photo-1512496015851-a90ab38aba96?w=200'] },
  { id: 2, name: 'Елена Морозова',  category: 'Маникюр', specialization: 'Нейл-дизайн',          price: 2500, rating: 4.8, reviews: 94,  description: 'Мастер маникюра с 5-летним стажем. Сложный дизайн, выравнивание.', photo: 'https://images.unsplash.com/photo-1604654894610-df4906b1150c?w=400', portfolio: ['https://images.unsplash.com/photo-1604654894610-df4906b1150c?w=200'] },
  { id: 3, name: 'Мария Волкова',   category: 'Брови',   specialization: 'Архитектура бровей',   price: 1800, rating: 5.0, reviews: 56,  description: 'Бровист с медицинским образованием. Коррекция, окрашивание, ламинирование.', photo: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=400', portfolio: ['https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=200'] },
  { id: 4, name: 'Ольга Новикова',  category: 'Волосы',  specialization: 'Стилист',              price: 3500, rating: 4.7, reviews: 73,  description: 'Стилист-парикмахер. Стрижки, окрашивание, укладки.', photo: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?w=400', portfolio: ['https://images.unsplash.com/photo-1562322140-8baeececf3df?w=200'] },
  { id: 5, name: 'Татьяна Белова',  category: 'Макияж',  specialization: 'Вечерний образ',       price: 4000, rating: 4.8, reviews: 45,  description: 'Визажист. Специализация: вечерний и свадебный макияж.', photo: 'https://images.unsplash.com/photo-1512496015851-a90ab38aba96?w=400', portfolio: ['https://images.unsplash.com/photo-1512496015851-a90ab38aba96?w=200'] },
  { id: 6, name: 'Ирина Соколова',  category: 'Уход',    specialization: 'Косметолог',           price: 3000, rating: 4.6, reviews: 38,  description: 'Косметолог. Чистки, уходовые процедуры.', photo: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=400', portfolio: ['https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?w=200'] }
];

// ─── Middleware: проверка JWT ──────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен не предоставлен' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Недействительный токен' });
  }
}

// ─── Авторизация ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { fullName, email, password, phone, role } = req.body;

  if (!fullName || !email || !password) {
    return res.status(400).json({ error: 'Заполните все обязательные поля' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Пароль должен содержать минимум 6 символов' });
  }
  if (users.find(u => u.email === email)) {
    return res.status(409).json({ error: 'Пользователь с таким email уже существует' });
  }

  const allowedRoles = ['client', 'master'];
  const userRole = allowedRoles.includes(role) ? role : 'client';

  const newUser = { id: nextUserId++, fullName, email, password, phone: phone || '', role: userRole };
  users.push(newUser);

  const token = jwt.sign({ id: newUser.id, email, role: userRole, fullName }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, user: { id: newUser.id, fullName, email, role: userRole } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, fullName: user.fullName }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, fullName: user.fullName, email: user.email, role: user.role } });
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

  const master = mockMasters.find(m => m.id === parseInt(masterId));
  if (!master) return res.status(404).json({ error: 'Мастер не найден' });

  const discount = parseFloat(promoDiscount) || 0;
  const totalCost = Math.round(master.price * (1 - discount / 100));

  const booking = {
    id: nextBookingId++,
    masterId: master.id,
    masterName: master.name,
    clientId: req.user.id,
    clientName: req.user.fullName,
    date, time,
    totalCost,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  bookings.push(booking);
  res.status(201).json(booking);
});

app.patch('/api/bookings/:id', authMiddleware, (req, res) => {
  const booking = bookings.find(b => b.id === parseInt(req.params.id));
  if (!booking) return res.status(404).json({ error: 'Бронирование не найдено' });

  const { status } = req.body;
  const allowed = ['confirmed', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Недопустимый статус' });

  // Клиент может только отменить своё
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

  const review = {
    id: Date.now(),
    masterId: parseInt(masterId),
    bookingId,
    clientId: req.user.id,
    userName: req.user.fullName,
    rating: parseFloat(rating),
    text: text || '',
    createdAt: new Date().toISOString()
  };
  reviews.push(review);
  res.status(201).json(review);
});

app.get('/api/reviews/:masterId', (req, res) => {
  res.json(reviews.filter(r => r.masterId === parseInt(req.params.masterId)));
});

// ─── Статические страницы ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ GLOW сервер запущен на http://localhost:${PORT}`);
});