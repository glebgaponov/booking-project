-- Схема базы данных ИС Поиска и бронирования услуг частных мастеров
-- Соответствие ГОСТ 34.201-89 (Модель данных)

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('client', 'master', 'admin'))
);

CREATE TABLE masters (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(50) NOT NULL,
    price_per_hour INT NOT NULL,
    rating NUMERIC(2,1) DEFAULT 5.0
);

CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    client_id INT REFERENCES users(id) ON DELETE CASCADE,
    master_id INT REFERENCES masters(id) ON DELETE CASCADE,
    booking_date VARCHAR(50) NOT NULL,
    total_cost INT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'))
);
