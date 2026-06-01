# GLOW Beauty Platform

Веб-приложение для онлайн-записи клиентов к мастерам красоты.  
Курсовой проект по дисциплине «Разработка информационных систем».

---

## Описание проекта

GLOW — информационная система для управления записями в салоне красоты. Система автоматизирует процесс онлайн-бронирования, управления расписанием мастеров и администрирования платформы.

**Основные функции:**
- Регистрация и авторизация пользователей (клиент / мастер / администратор)
- Онлайн-запись к мастеру с учётом длительности процедуры
- Управление расписанием мастера (блокировка/разблокировка слотов)
- Перенос и отмена записей (клиентом и администратором)
- Система отзывов клиентов
- Административная панель с аналитикой

---

## Стек технологий

### Frontend
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| HTML5 / CSS3 | — | Разметка и стили |
| JavaScript (ES2020) | — | Логика на клиенте |
| Inter (Google Fonts) | — | Шрифт |
| Fetch API | — | HTTP-запросы к REST API |
| localStorage | — | Хранение JWT-токена и кэша |
| Service Worker | — | PWA, офлайн-режим |

### Backend
| Технология | Версия | Назначение |
|-----------|--------|-----------|
| Node.js | 18+ | Среда выполнения |
| Express | 4.18 | HTTP-фреймворк |
| better-sqlite3 | 9.4 | ORM-подобный доступ к SQLite |
| bcryptjs | 2.4 | Хэширование паролей |
| jsonwebtoken | 9.0 | JWT-авторизация |
| helmet | 7.1 | HTTP security headers |
| express-rate-limit | 7.1 | Ограничение частоты запросов |
| cors | 2.8 | Управление CORS |
| dotenv | 16.3 | Переменные окружения |

### База данных
- **SQLite** через `better-sqlite3`
- Файл БД: `backend/glow.db` (создаётся автоматически)

---

## Архитектура

```
glow-project/
├── frontend/               # Статические HTML-страницы
│   ├── index.html          # Главная — каталог мастеров, запись
│   ├── auth.html           # Авторизация и регистрация
│   ├── client-profile.html # Кабинет клиента + панель администратора
│   ├── master-profile.html # Кабинет мастера
│   ├── about.html          # Страница «О нас»
│   ├── 404.html            # Страница ошибки
│   ├── manifest.json       # PWA манифест
│   ├── sw.js               # Service Worker
│   ├── favicon.ico         # Иконка сайта
│   └── icons/              # PNG иконки (16, 32, 192, 512 px)
│
└── backend/
    ├── server.js           # Express-сервер, маршруты API
    ├── db.js               # Схема БД, модели, запросы
    ├── logger.js           # Модуль логирования (audit log)
    ├── package.json        # Зависимости
    ├── .env.example        # Шаблон переменных окружения
    └── tests/
        └── api.test.js     # Jest-тесты API
```

---

## Роли пользователей

| Роль | Возможности |
|------|------------|
| **Клиент** | Запись к мастеру, перенос/отмена записи, отзывы, избранное |
| **Мастер** | Запись клиентов вручную, управление расписанием, перенос записей |
| **Администратор** | Все функции мастера + полная панель: все записи, пользователи, экспорт |

---

## REST API

| Метод | Путь | Доступ | Описание |
|-------|------|--------|----------|
| POST | /api/auth/register | Public | Регистрация |
| POST | /api/auth/login | Public | Вход |
| GET | /api/auth/me | Auth | Текущий пользователь |
| GET | /api/masters | Public | Список мастеров |
| GET | /api/masters/:id | Public | Мастер по ID |
| GET | /api/appointments | Auth | Записи (фильтрация) |
| POST | /api/appointments | Auth | Создать запись |
| PATCH | /api/appointments/:id | Auth | Обновить/перенести |
| DELETE | /api/appointments/:id | Auth | Отменить |
| GET | /api/blocked | Public | Заблокированные слоты |
| POST | /api/blocked | Admin | Заблокировать слот |
| DELETE | /api/blocked | Admin | Разблокировать слот |
| GET | /api/admin/users | Admin | Список пользователей |
| GET | /api/admin/stats | Admin | Статистика |

---

## Паттерны проектирования

### 1. Middleware (Цепочка обязанностей)
Использован в Express для авторизации и ограничения доступа:
```js
// server.js
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.slice(7);
  req.user = jwt.verify(token, JWT_SECRET);
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({error:'Доступ запрещён'});
  next();
}
app.get('/api/admin/users', authMiddleware, adminOnly, handler);
```

### 2. Repository (Репозиторий)
Весь доступ к данным инкапсулирован в модуле `db.js`:
```js
// db.js
const Users = {
  findByEmail: email => db.prepare('SELECT * FROM users WHERE email=?').get(email),
  create: ({name, email, password, role}) => db.prepare('INSERT INTO users...').run(...),
  all: () => db.prepare('SELECT id,name,email,role FROM users').all(),
};
```

### 3. Singleton (Одиночка)
Единственный экземпляр подключения к БД на всё приложение:
```js
// db.js
const db = new Database(DB_PATH); // создаётся один раз при импорте
db.pragma('journal_mode = WAL');
module.exports = { db, Users, Appointments, Blocked };
```

---

## Безопасность

- **Пароли** хэшируются через `bcryptjs` (salt rounds: 10)
- **JWT** хранятся в `localStorage` на клиенте, передаются в заголовке `Authorization: Bearer`
- **Helmet** устанавливает защитные HTTP-заголовки
- **Rate Limiting**: максимум 200 запросов/15 мин, для авторизации — 15/15 мин
- **Разграничение ролей**: каждый маршрут проверяет роль через middleware
- **Аудит-лог**: все действия пользователей записываются в `backend/logs/audit.log`

---

## Быстрый старт

```bash
# 1. Перейти в папку бэкенда
cd glow-project/backend

# 2. Скопировать конфиг
cp .env.example .env

# 3. Установить зависимости
npm install

# 4. Запустить сервер
npm start
# Сервер: http://localhost:3000

# 5. Запустить тесты
npm test
```

### Demo-аккаунты
| Роль | Email | Пароль |
|------|-------|--------|
| Администратор | admin@glow.com | admin123 |
| Клиент | client@glow.com | client123 |
| Мастер | master@glow.com | master123 |

---

## Сброс базы данных

```bash
npm run db:reset
```

---

## Лицензия

Учебный проект. 2026.
