const express = require('express');
const cors = require('cors');
const { Bot, InlineKeyboard, webhookCallback } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const path = require('path');

// Проверка переменных
console.log('=== ENV CHECK ===');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING');
console.log('SUPABASE_KEY:', process.env.SUPABASE_KEY ? 'SET' : 'MISSING');
console.log('TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'SET' : 'MISSING');
console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'MISSING');
console.log('WEBAPP_URL:', process.env.WEBAPP_URL ? 'SET' : 'MISSING');
console.log('=================');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('Missing Supabase credentials!');
    console.log('All env vars:', Object.keys(process.env).join(', '));
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Supabase
const supabase = createClient(
    process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_KEY || 'placeholder'
);

// OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'placeholder'
});

// Telegram Bot
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || 'placeholder');

// Вспомогательные функции
async function getOrCreateUser(telegramUser) {
    const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramUser.id)
        .single();
    
    if (existingUser) return existingUser;
    
    const { data: newUser, error } = await supabase
        .from('users')
        .insert({
            telegram_id: telegramUser.id,
            telegram_username: telegramUser.username,
            first_name: telegramUser.first_name,
            last_name: telegramUser.last_name,
            language_code: telegramUser.language_code || 'ru'
        })
        .select()
        .single();
    
    if (error) console.error('Error creating user:', error);
    return newUser;
}

// Команда /start
bot.command('start', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    
    const keyboard = new InlineKeyboard()
        .text('👤 Я клиент', 'role_client')
        .text('🏋️ Я тренер', 'role_trainer');
    
    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\n` +
        `Добро пожаловать в FitTracker — твой персональный помощник для тренировок.\n\n` +
        `Кто ты?`,
        { reply_markup: keyboard }
    );
});

// Выбор роли: Клиент
bot.callbackQuery('role_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await supabase
        .from('users')
        .update({ role: 'client' })
        .eq('telegram_id', ctx.from.id);
    
    const keyboard = new InlineKeyboard()
        .webApp('🏋️ Открыть тренировку', `${process.env.WEBAPP_URL}/workout`)
        .row()
        .text('📊 Мой прогресс', 'my_progress')
        .row()
        .text('🤖 Создать программу (ИИ)', 'ai_program');
    
    await ctx.editMessageText(
        `Отлично! Ты зарегистрирован как клиент.\n\nЧто хочешь сделать?`,
        { reply_markup: keyboard }
    );
});

// Выбор роли: Тренер
bot.callbackQuery('role_trainer', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await supabase
        .from('users')
        .update({ role: 'trainer' })
        .eq('telegram_id', ctx.from.id);
    
    const keyboard = new InlineKeyboard()
        .text('➕ Добавить клиента', 'add_client')
        .row()
        .text('📋 Мои клиенты', 'my_clients')
        .row()
        .text('✍️ Создать программу', 'create_program');
    
    await ctx.editMessageText(
        `Отлично! Ты зарегистрирован как тренер.\n\nТвой тариф: Старт (бесплатно)\nКлиентов: 0/3\n\nЧто хочешь сделать?`,
        { reply_markup: keyboard }
    );
});

// Добавить клиента
bot.callbackQuery('add_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `Чтобы добавить клиента, отправь его @username в Telegram.\n\nНапример: @ivan_petrov`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_trainer') }
    );
});

// Мои клиенты
bot.callbackQuery('my_clients', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `У тебя пока нет клиентов.\n\nДобавь первого клиента по его @username.`,
        { reply_markup: new InlineKeyboard().text('➕ Добавить клиента', 'add_client').row().text('« Назад', 'role_trainer') }
    );
});

// Прогресс
bot.callbackQuery('my_progress', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `📊 Твой прогресс\n\nСкоро здесь появятся графики!`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_client') }
    );
});

// ИИ программа
bot.callbackQuery('ai_program', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `🤖 Создание программы с ИИ\n\nОпиши свою цель и уровень подготовки.`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_client') }
    );
});

// API endpoints
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', env: {
        supabase: !!process.env.SUPABASE_URL,
        telegram: !!process.env.TELEGRAM_BOT_TOKEN,
        openai: !!process.env.OPENAI_API_KEY
    }});
});

// Webhook
if (process.env.NODE_ENV === 'production') {
    app.use('/webhook', webhookCallback(bot, 'express'));
}

// Запуск
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    if (process.env.NODE_ENV === 'production' && process.env.WEBAPP_URL) {
        const webhookUrl = `${process.env.WEBAPP_URL}/webhook`;
        await bot.api.setWebhook(webhookUrl);
        console.log(`🔗 Webhook set to ${webhookUrl}`);
    } else {
        console.log('Starting bot with polling...');
        bot.start();
    }
});
