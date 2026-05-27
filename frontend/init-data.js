// Расширенная структура данных для GLOW
const initData = () => {
    // Мастера с расширенной информацией
    if (!localStorage.getItem('glow_masters')) {
        const masters = [
            { 
                id: 1, name: "Анна Соловьёва", email: "anna@glow.com", password: "master123",
                category: "Макияж", specialization: "Свадебный визаж", price: 4500, 
                rating: 4.9, reviews: 128, phone: "+7 (999) 123-45-67",
                description: "Визажист с 5-летним опытом. Работала на неделе моды в Москве.",
                schedule: [],
                role: "master"
            },
            { 
                id: 2, name: "Елена Морозова", email: "elena@glow.com", password: "master123",
                category: "Маникюр", specialization: "Нейл-дизайн", price: 2500,
                rating: 4.8, reviews: 94, phone: "+7 (999) 234-56-78",
                description: "Мастер маникюра, люблю сложные дизайны.",
                schedule: [],
                role: "master"
            },
            { 
                id: 3, name: "Мария Волкова", email: "maria@glow.com", password: "master123",
                category: "Брови", specialization: "Архитектура бровей", price: 1800,
                rating: 5.0, reviews: 56, phone: "+7 (999) 345-67-89",
                description: "Бровист с медицинским образованием.",
                schedule: [],
                role: "master"
            }
        ];
        localStorage.setItem('glow_masters', JSON.stringify(masters));
    }
    
    // Заявки (связь клиент-мастер)
    if (!localStorage.getItem('glow_appointments')) {
        localStorage.setItem('glow_appointments', JSON.stringify([]));
    }
    
    // Чаты
    if (!localStorage.getItem('glow_messages')) {
        localStorage.setItem('glow_messages', JSON.stringify([]));
    }
    
    // Промокоды
    if (!localStorage.getItem('glow_promocodes')) {
        const promocodes = [
            { code: "WELCOME10", discount: 10, used: false, expires: "2025-12-31" },
            { code: "GLOW20", discount: 20, used: false, expires: "2025-06-30" }
        ];
        localStorage.setItem('glow_promocodes', JSON.stringify(promocodes));
    }
    
    // Уведомления
    if (!localStorage.getItem('glow_notifications')) {
        localStorage.setItem('glow_notifications', JSON.stringify([]));
    }
};
