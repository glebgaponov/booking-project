/**
 * GLOW — Audit Logger
 * Ведение журнала действий пользователей согласно
 * ГОСТ Р ИСО/МЭК 27001-2012, приложение A.12.4
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

// Создать папку logs если её нет
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Записать событие в audit.log
 * @param {string} action  — тип события (LOGIN, REGISTER, BOOKING_CREATE, ...)
 * @param {object} details — дополнительные данные
 * @param {object} req     — Express request (для извлечения IP и user)
 */
function log(action, details = {}, req = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    userId:    req?.user?.id    || null,
    userEmail: req?.user?.email || null,
    userRole:  req?.user?.role  || null,
    ip:        req?.ip || req?.connection?.remoteAddress || null,
    method:    req?.method || null,
    path:      req?.path   || null,
    ...details,
  };

  const line = JSON.stringify(entry) + '\n';
  fs.appendFile(LOG_FILE, line, err => {
    if (err) console.error('[Logger] Ошибка записи в лог:', err.message);
  });

  // Также выводим в консоль (без sensitive данных)
  console.log(`[${entry.timestamp}] ${action} | user:${entry.userId ?? 'anon'} | ${entry.method ?? ''} ${entry.path ?? ''}`);
}

// Middleware для автоматической записи всех запросов
function requestLogger(req, res, next) {
  res.on('finish', () => {
    log('HTTP_REQUEST', { status: res.statusCode }, req);
  });
  next();
}

module.exports = { log, requestLogger };
