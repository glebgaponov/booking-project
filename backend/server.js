const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.get('/auth.html', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/auth.html'));
});

const mockMasters = [
    { id: 1, name: "Анна Соловьёва", category: "Макияж", specialization: "Свадебный визаж", price: 4500, rating: 4.9, reviews: 128 },
    { id: 2, name: "Елена Морозова", category: "Маникюр", specialization: "Нейл-дизайн", price: 2500, rating: 4.8, reviews: 94 },
    { id: 3, name: "Мария Волкова", category: "Брови", specialization: "Архитектура бровей", price: 1800, rating: 5.0, reviews: 56 },
    { id: 4, name: "Ольга Новикова", category: "Волосы", specialization: "Стилист", price: 3500, rating: 4.7, reviews: 73 },
    { id: 5, name: "Татьяна Белова", category: "Макияж", specialization: "Вечерний образ", price: 4000, rating: 4.8, reviews: 45 },
    { id: 6, name: "Ирина Соколова", category: "Уход", specialization: "Косметолог", price: 3000, rating: 4.6, reviews: 38 }
];

app.get('/api/masters', (req, res) => {
    let result = [...mockMasters];
    const { category, maxPrice, minRating } = req.query;
    
    if (category) {
        result = result.filter(m => m.category.toLowerCase().includes(category.toLowerCase()));
    }
    if (maxPrice) {
        result = result.filter(m => m.price <= parseInt(maxPrice));
    }
    if (minRating) {
        result = result.filter(m => m.rating >= parseFloat(minRating));
    }
    
    const calculatedResult = result.map(m => ({
        ...m,
        preliminaryTotal: Math.round(m.price * 1.10)
    }));
    
    res.json(calculatedResult);
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});
