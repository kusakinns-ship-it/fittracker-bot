# FitTracker 🏋️

Telegram Mini App для отслеживания тренировок с ИИ-анализом прогрессии.

## Возможности

### Для клиентов
- 📱 Удобный интерфейс в Telegram
- 📊 Отслеживание каждого подхода
- 📈 Графики прогресса
- 🤖 ИИ-генерация программ

### Для тренеров
- 👥 Управление клиентами
- ✍️ Создание программ (ручное + ИИ)
- 📋 Отчёты о тренировках
- 🔔 Уведомления о выполнении

## Технологии

- **Backend:** Node.js, Express
- **Bot:** Grammy (Telegram Bot API)
- **Database:** Supabase (PostgreSQL)
- **AI:** OpenAI GPT-4
- **Hosting:** Railway

## Установка

Смотри [DEPLOY.md](./DEPLOY.md) для пошаговой инструкции.

## Структура проекта

```
fittracker/
├── src/
│   └── index.js        # Сервер + бот
├── public/
│   ├── index.html      # Главная страница
│   └── workout/
│       └── index.html  # Mini App тренировки
├── database/
│   └── schema.sql      # Схема базы данных
├── package.json
├── .env.example
├── DEPLOY.md
└── README.md
```

## Лицензия

MIT
