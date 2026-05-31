/**
 * GLOW Beauty Platform — Backend API Tests
 * Запуск: npm test
 *
 * Тестирует: авторизацию, записи, защиту маршрутов
 */

const http = require('http');
const path = require('path');

// ─── Простой HTTP-клиент без внешних зависимостей ────────────────
const BASE = 'http://localhost:3001';

function request(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Запуск тестового сервера на порту 3001 ───────────────────────
let server;
let adminToken, clientToken;
const TEST_DB = path.join(__dirname, '../test.db');

beforeAll(async () => {
  process.env.PORT = '3001';
  process.env.DB_PATH = TEST_DB;
  process.env.JWT_SECRET = 'test-secret';

  // Удалить тестовую БД если существует
  try { require('fs').unlinkSync(TEST_DB); } catch {}

  const app = require('../server');
  // server.js вызывает app.listen сам, ждём немного
  await new Promise(r => setTimeout(r, 300));
}, 10000);

afterAll(async () => {
  try { require('fs').unlinkSync(TEST_DB); } catch {}
});

// ════════════════════════════════════════════════════════════════
// БЛОК 1: Авторизация
// ════════════════════════════════════════════════════════════════
describe('Авторизация', () => {

  test('Регистрация нового клиента', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Тест Клиент',
      email: 'test_client@glow.com',
      password: 'testpass123',
      role: 'client',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe('test_client@glow.com');
    expect(res.body.user.role).toBe('client');
    clientToken = res.body.token;
  });

  test('Повторная регистрация с тем же email — ошибка 409', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Дубль',
      email: 'test_client@glow.com',
      password: 'testpass123',
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBeTruthy();
  });

  test('Регистрация без пароля — ошибка 400', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Без пароля',
      email: 'nopass@glow.com',
    });
    expect(res.status).toBe(400);
  });

  test('Короткий пароль — ошибка 400', async () => {
    const res = await request('POST', '/api/auth/register', {
      name: 'Короткий',
      email: 'short@glow.com',
      password: '123',
    });
    expect(res.status).toBe(400);
  });

  test('Вход с demo-аккаунтом admin@glow.com', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'admin@glow.com',
      password: 'admin123',
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('admin');
    adminToken = res.body.token;
  });

  test('Вход с неверным паролем — ошибка 401', async () => {
    const res = await request('POST', '/api/auth/login', {
      email: 'admin@glow.com',
      password: 'wrongpassword',
    });
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me с валидным токеном', async () => {
    const res = await request('GET', '/api/auth/me', null, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('admin@glow.com');
  });

  test('GET /api/auth/me без токена — ошибка 401', async () => {
    const res = await request('GET', '/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// БЛОК 2: Мастера (публичные маршруты)
// ════════════════════════════════════════════════════════════════
describe('Мастера', () => {

  test('GET /api/masters возвращает список', async () => {
    const res = await request('GET', '/api/masters');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  test('GET /api/masters?category=manicure — фильтрация', async () => {
    const res = await request('GET', '/api/masters?category=manicure');
    expect(res.status).toBe(200);
    res.body.forEach(m => expect(m.category).toBe('manicure'));
  });

  test('GET /api/masters/1 — конкретный мастер', async () => {
    const res = await request('GET', '/api/masters/1');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.duration).toBeTruthy();
  });

  test('GET /api/masters/999 — несуществующий мастер', async () => {
    const res = await request('GET', '/api/masters/999');
    expect(res.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════
// БЛОК 3: Записи (защищённые маршруты)
// ════════════════════════════════════════════════════════════════
describe('Записи (бронирования)', () => {

  test('POST /api/appointments — создать запись', async () => {
    const res = await request('POST', '/api/appointments', {
      masterId: 1,
      masterName: 'Анна Соколова',
      service: 'Маникюр',
      date: '2099-12-01',
      time: '10:00',
      durationMins: 150,
      payMethod: 'cash',
    }, clientToken);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('confirmed');
  });

  test('POST /api/appointments — конфликт времени', async () => {
    const res = await request('POST', '/api/appointments', {
      masterId: 1,
      masterName: 'Анна Соколова',
      service: 'Маникюр',
      date: '2099-12-01',
      time: '10:00', // то же время
      durationMins: 150,
    }, clientToken);
    expect(res.status).toBe(409);
  });

  test('POST /api/appointments без токена — ошибка 401', async () => {
    const res = await request('POST', '/api/appointments', {
      masterId: 1, date: '2099-12-02', time: '09:00',
    });
    expect(res.status).toBe(401);
  });

  test('GET /api/appointments с токеном клиента', async () => {
    const res = await request('GET', '/api/appointments', null, clientToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// БЛОК 4: Административные маршруты
// ════════════════════════════════════════════════════════════════
describe('Администрирование', () => {

  test('GET /api/admin/users — доступно только администратору', async () => {
    const res = await request('GET', '/api/admin/users', null, adminToken);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('GET /api/admin/users с клиентским токеном — ошибка 403', async () => {
    const res = await request('GET', '/api/admin/users', null, clientToken);
    expect(res.status).toBe(403);
  });

  test('GET /api/admin/stats', async () => {
    const res = await request('GET', '/api/admin/stats', null, adminToken);
    expect(res.status).toBe(200);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.active).toBe('number');
  });

  test('POST /api/blocked — заблокировать слот (только admin)', async () => {
    const res = await request('POST', '/api/blocked', {
      masterId: 2, date: '2099-12-05', time: '14:00',
    }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/blocked клиентским токеном — ошибка 403', async () => {
    const res = await request('POST', '/api/blocked', {
      masterId: 2, date: '2099-12-05', time: '15:00',
    }, clientToken);
    expect(res.status).toBe(403);
  });
});
