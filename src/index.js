const express = require('express');
const cors = require('cors');
const { Bot, InlineKeyboard, webhookCallback } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

console.log('=== STARTING SERVER ===');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Telegram Bot
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Error handler for bot
bot.catch((err) => {
    console.error('Bot error:', err);
});

// Команда /start
bot.command('start', async (ctx) => {
    console.log('Received /start from:', ctx.from.id);
    try {
        const keyboard = new InlineKeyboard()
            .text('👤 Я клиент', 'role_client')
            .text('🏋️ Я тренер', 'role_trainer');
        
        await ctx.reply(
            `Привет, ${ctx.from.first_name}! 👋\n\n` +
            `Добро пожаловать в FitTracker — твой персональный помощник для тренировок.\n\n` +
            `Кто ты?`,
            { reply_markup: keyboard }
        );
        console.log('Reply sent successfully');
    } catch (error) {
        console.error('Error in /start:', error);
    }
});

// Выбор роли: Клиент
bot.callbackQuery('role_client', async (ctx) => {
    console.log('Callback: role_client');
    try {
        await ctx.answerCallbackQuery();
        
        const keyboard = new InlineKeyboard()
            .text('📊 Мой прогресс', 'my_progress')
            .row()
            .text('🤖 Создать программу (ИИ)', 'ai_program');
        
        await ctx.editMessageText(
            `Отлично! Ты зарегистрирован как клиент.\n\nЧто хочешь сделать?`,
            { reply_markup: keyboard }
        );
    } catch (error) {
        console.error('Error in role_client:', error);
    }
});

// Выбор роли: Тренер
bot.callbackQuery('role_trainer', async (ctx) => {
    console.log('Callback: role_trainer');
    try {
        await ctx.answerCallbackQuery();
        
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
    } catch (error) {
        console.error('Error in role_trainer:', error);
    }
});

// Другие callback handlers
bot.callbackQuery('add_client', async (ctx) => {
    try {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `Чтобы добавить клиента, отправь его @username.\n\nНапример: @ivan_petrov`,
            { reply_markup: new InlineKeyboard().text('« Назад', 'role_trainer') }
        );
    } catch (error) {
        console.error('Error:', error);
    }
});

bot.callbackQuery('my_clients', async (ctx) => {
    try {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `У тебя пока нет клиентов.`,
            { reply_markup: new InlineKeyboard().text('➕ Добавить', 'add_client').row().text('« Назад', 'role_trainer') }
        );
    } catch (error) {
        console.error('Error:', error);
    }
});

bot.callbackQuery('create_program', async (ctx) => {
    try {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `Отправь программу тренировки текстом.\n\nПример:\n1️⃣ ПРИСЕД 100×5×5\n2️⃣ ЖИМ 70×8×4`,
            { reply_markup: new InlineKeyboard().text('« Назад', 'role_trainer') }
        );
    } catch (error) {
        console.error('Error:', error);
    }
});

bot.callbackQuery('my_progress', async (ctx) => {
    try {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `📊 Твой прогресс\n\nСкоро здесь появятся графики!`,
            { reply_markup: new InlineKeyboard().text('« Назад', 'role_client') }
        );
    } catch (error) {
        console.error('Error:', error);
    }
});

bot.callbackQuery('ai_program', async (ctx) => {
    try {
        await ctx.answerCallbackQuery();
        await ctx.editMessageText(
            `🤖 Создание программы с ИИ\n\nОпиши свою цель и уровень подготовки.`,
            { reply_markup: new InlineKeyboard().text('« Назад', 'role_client') }
        );
    } catch (error) {
        console.error('Error:', error);
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Webhook с логированием
app.post('/webhook', async (req, res) => {
    console.log('Webhook received:', JSON.stringify(req.body).substring(0, 200));
    try {
        await webhookCallback(bot, 'express')(req, res);
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    try {
        const webhookUrl = `${process.env.WEBAPP_URL}/webhook`;
        await bot.api.setWebhook(webhookUrl);
        console.log(`🔗 Webhook set to ${webhookUrl}`);
    } catch (error) {
        console.error('Failed to set webhook:', error);
    }
});
