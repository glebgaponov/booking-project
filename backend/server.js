require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'glow_super_secret_jwt_key_2024';
const SALT_ROUNDS = 10;

// In-memory storage
const users = [];
const appointments = [];

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      connectSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      workerSrc: ["'self'"]
    }
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Слишком много попыток. Попробуйте через 15 минут.' },
  standardHeaders: true,
  legacyHeaders: false
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Слишком много запросов.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

// Init admin user
async function initAdminUser() {
  const adminExists = users.find(u => u.email === 'admin@glow.com');
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('admin123', SALT_ROUNDS);
    users.push({
      id: 1,
      email: 'admin@glow.com',
      password: hashedPassword,
      name: 'Admin',
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    console.log('✅ Admin user created: admin@glow.com / admin123');
  }
}

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен не предоставлен' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Недействительный токен' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }
  next();
}

// === AUTH ROUTES ===
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Заполните все поля' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Некорректный email' });
    }
    if (users.find(u => u.email === email)) {
      return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const newUser = {
      id: users.length + 1,
      email,
      password: hashedPassword,
      name,
      role: role === 'master' ? 'master' : 'client',
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    const token = jwt.sign(
      { id: newUser.id, email: newUser.email, role: newUser.role, name: newUser.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({
      message: 'Регистрация успешна',
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Введите email и пароль' });
    }
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Вход выполнен',
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
});

// === MASTERS ROUTES ===
const mastersData = [
  { id: 1, name: 'Анна Соколова', specialty: 'Мастер маникюра', rating: 4.9, reviews: 127, price: 'от 1500 ₽', experience: '5 лет', services: ['Маникюр', 'Педикюр', 'Гель-лак', 'Наращивание'], avatar: 'АС', gradient: 'linear-gradient(135deg, #f093fb, #f5576c)' },
  { id: 2, name: 'Мария Иванова', specialty: 'Бровист', rating: 4.8, reviews: 89, price: 'от 2000 ₽', experience: '3 года', services: ['Коррекция бровей', 'Окрашивание', 'Ламинирование', 'Татуаж'], avatar: 'МИ', gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)' },
  { id: 3, name: 'Елена Козлова', specialty: 'Визажист', rating: 5.0, reviews: 203, price: 'от 3000 ₽', experience: '7 лет', services: ['Дневной макияж', 'Вечерний макияж', 'Свадебный образ', 'Обучение'], avatar: 'ЕК', gradient: 'linear-gradient(135deg, #43e97b, #38f9d7)' },
  { id: 4, name: 'Ольга Петрова', specialty: 'Мастер по волосам', rating: 4.7, reviews: 156, price: 'от 2500 ₽', experience: '6 лет', services: ['Стрижка', 'Окрашивание', 'Укладка', 'Кератин'], avatar: 'ОП', gradient: 'linear-gradient(135deg, #fa709a, #fee140)' },
  { id: 5, name: 'Наталья Сидорова', specialty: 'Косметолог', rating: 4.9, reviews: 94, price: 'от 3500 ₽', experience: '8 лет', services: ['Чистка лица', 'Пилинг', 'Мезотерапия', 'Массаж лица'], avatar: 'НС', gradient: 'linear-gradient(135deg, #a18cd1, #fbc2eb)' },
  { id: 6, name: 'Юлия Новикова', specialty: 'Лэшмейкер', rating: 4.8, reviews: 112, price: 'от 2200 ₽', experience: '4 года', services: ['Наращивание ресниц', 'Ламинирование', 'Окрашивание', 'Долговременная завивка'], avatar: 'ЮН', gradient: 'linear-gradient(135deg, #f7971e, #ffd200)' }
];

app.get('/api/masters', (req, res) => {
  res.json(mastersData);
});

app.get('/api/masters/:id', (req, res) => {
  const master = mastersData.find(m => m.id === parseInt(req.params.id));
  if (!master) return res.status(404).json({ error: 'Мастер не найден' });
  res.json(master);
});

// === APPOINTMENTS ROUTES ===
app.post('/api/appointments', authenticateToken, (req, res) => {
  try {
    const { masterId, date, time, comment, promoCode, payMethod } = req.body;
    if (!masterId || !date || !time) {
      return res.status(400).json({ error: 'Заполните обязательные поля' });
    }
    const appointment = {
      id: appointments.length + 1,
      userId: req.user.id,
      masterId,
      date,
      time,
      comment: comment || '',
      promoCode: promoCode || '',
      payMethod: payMethod || 'card',
      status: 'confirmed',
      createdAt: new Date().toISOString()
    };
    appointments.push(appointment);
    res.status(201).json({ message: 'Запись создана', appointment });
  } catch (error) {
    console.error('Appointment error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/appointments', authenticateToken, (req, res) => {
  const userAppointments = appointments.filter(a => a.userId === req.user.id);
  res.json(userAppointments);
});

app.delete('/api/appointments/:id', authenticateToken, (req, res) => {
  const idx = appointments.findIndex(a => a.id === parseInt(req.params.id) && a.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Запись не найдена' });
  appointments.splice(idx, 1);
  res.json({ message: 'Запись отменена' });
});

// === PROMO CODES ===
const promoCodes = {
  'GLOW10': 10,
  'BEAUTY20': 20,
  'FIRST15': 15,
  'VIP30': 30
};

app.post('/api/promo/validate', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введите промокод' });
  const discount = promoCodes[code.toUpperCase()];
  if (!discount) return res.status(404).json({ error: 'Промокод не найден' });
  res.json({ valid: true, discount, message: `Скидка ${discount}% применена!` });
});

// === ADMIN ROUTES ===
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const safeUsers = users.map(({ password, ...u }) => u);
  res.json(safeUsers);
});

app.get('/api/admin/appointments', authenticateToken, requireAdmin, (req, res) => {
  res.json(appointments);
});

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Маршрут не найден' });
  }
  res.sendFile(path.join(__dirname, '../frontend/404.html'));
});

// Start
initAdminUser().then(() => {
  app.listen(PORT, () => {
    console.log(`\n✨ GLOW Beauty Platform running at http://localhost:${PORT}`);
    console.log(`📁 Serving frontend from: ${path.join(__dirname, '../frontend')}`);
    console.log(`🔑 Admin: admin@glow.com / admin123\n`);
  });
});
