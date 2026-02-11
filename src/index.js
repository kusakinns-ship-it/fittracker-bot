const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Получить или создать пользователя
async function getOrCreateUser(telegramUser) {
    // Ищем существующего
    const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramUser.id)
        .single();
    
    if (existing) {
        console.log('User found:', existing.id);
        return existing;
    }
    
    // Создаём нового
    const { data: newUser, error } = await supabase
        .from('users')
        .insert({
            telegram_id: telegramUser.id,
            telegram_username: telegramUser.username,
            first_name: telegramUser.first_name,
            last_name: telegramUser.last_name
        })
        .select()
        .single();
    
    if (error) {
        console.error('Error creating user:', error.message);
        return null;
    }
    
    console.log('User created:', newUser.id);
    return newUser;
}

// Команда /start
bot.command('start', async (ctx) => {
    console.log('START from', ctx.from.id);
    
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

// Выбор: Клиент
bot.callbackQuery('role_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    // Сохраняем роль
    await supabase
        .from('users')
        .update({ role: 'client' })
        .eq('telegram_id', ctx.from.id);
    
    const keyboard = new InlineKeyboard()
        .text('📊 Мой прогресс', 'my_progress')
        .row()
        .text('🤖 Создать программу (ИИ)', 'ai_program')
        .row()
        .text('⚙️ Настройки', 'settings');
    
    await ctx.editMessageText(
        `✅ Ты зарегистрирован как клиент!\n\n` +
        `Твой тариф: Free\n\n` +
        `Что хочешь сделать?`,
        { reply_markup: keyboard }
    );
});

// Выбор: Тренер
bot.callbackQuery('role_trainer', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    // Сохраняем роль
    await supabase
        .from('users')
        .update({ role: 'trainer' })
        .eq('telegram_id', ctx.from.id);
    
    // Считаем клиентов
    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    const { count } = await supabase
        .from('trainer_clients')
        .select('*', { count: 'exact', head: true })
        .eq('trainer_id', user?.id);
    
    const keyboard = new InlineKeyboard()
        .text('➕ Добавить клиента', 'add_client')
        .row()
        .text('📋 Мои клиенты', 'my_clients')
        .row()
        .text('✍️ Создать программу', 'create_program')
        .row()
        .text('⚙️ Настройки', 'settings');
    
    await ctx.editMessageText(
        `✅ Ты зарегистрирован как тренер!\n\n` +
        `Твой тариф: Старт (бесплатно)\n` +
        `Клиентов: ${count || 0}/3\n\n` +
        `Что хочешь сделать?`,
        { reply_markup: keyboard }
    );
});

// Добавить клиента
bot.callbackQuery('add_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await supabase
        .from('users')
        .update({ state: 'waiting_client_username' })
        .eq('telegram_id', ctx.from.id);
    
    await ctx.editMessageText(
        `👤 Добавление клиента\n\n` +
        `Отправь @username клиента в Telegram.\n\n` +
        `Например: @ivan_petrov\n\n` +
        `⚠️ Клиент должен сначала запустить этого бота.`,
        { reply_markup: new InlineKeyboard().text('« Отмена', 'role_trainer') }
    );
});

// Мои клиенты
bot.callbackQuery('my_clients', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    const { data: clients } = await supabase
        .from('trainer_clients')
        .select(`
            client:client_id (
                id, first_name, last_name, telegram_username
            )
        `)
        .eq('trainer_id', user?.id)
        .eq('status', 'active');
    
    if (!clients || clients.length === 0) {
        await ctx.editMessageText(
            `📋 Мои клиенты\n\n` +
            `У тебя пока нет клиентов.\n\n` +
            `Добавь первого клиента по его @username.`,
            { 
                reply_markup: new InlineKeyboard()
                    .text('➕ Добавить клиента', 'add_client')
                    .row()
                    .text('« Назад', 'role_trainer')
            }
        );
        return;
    }
    
    const keyboard = new InlineKeyboard();
    clients.forEach(({ client }) => {
        const name = `${client.first_name} ${client.last_name || ''}`.trim();
        keyboard.text(name, `client_${client.id}`).row();
    });
    keyboard.text('« Назад', 'role_trainer');
    
    await ctx.editMessageText(
        `📋 Мои клиенты (${clients.length}):\n\n` +
        `Выбери клиента для управления:`,
        { reply_markup: keyboard }
    );
});

// Мой прогресс (для клиента)
bot.callbackQuery('my_progress', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `📊 Твой прогресс\n\n` +
        `Скоро здесь появятся графики и статистика!`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_client') }
    );
});

// Создать программу (ИИ)
bot.callbackQuery('ai_program', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `🤖 Создание программы с ИИ\n\n` +
        `Опиши свою цель, уровень подготовки и сколько дней в неделю хочешь тренироваться.\n\n` +
        `Например: "Хочу набрать мышечную массу, тренируюсь 3 раза в неделю, уровень средний"`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_client') }
    );
});

// Создать программу (тренер)
bot.callbackQuery('create_program', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `✍️ Создание программы\n\n` +
        `Отправь программу тренировки текстом.\n\n` +
        `Пример формата:\n` +
        `📅 ПОНЕДЕЛЬНИК - ПРИСЕД\n` +
        `1️⃣ Приседания 100×5×5\n` +
        `2️⃣ Жим ногами 80×10×4\n` +
        `3️⃣ Разгибания 40×12×3`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_trainer') }
    );
});

// Настройки
bot.callbackQuery('settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    const backButton = user?.role === 'trainer' ? 'role_trainer' : 'role_client';
    
    await ctx.editMessageText(
        `⚙️ Настройки\n\n` +
        `👤 Имя: ${user?.first_name || 'Не указано'}\n` +
        `📱 Username: @${user?.telegram_username || 'Не указан'}\n` +
        `🎭 Роль: ${user?.role === 'trainer' ? 'Тренер' : 'Клиент'}\n` +
        `💎 Тариф: Free`,
        { reply_markup: new InlineKeyboard().text('« Назад', backButton) }
    );
});

// Обработка текстовых сообщений
bot.on('message:text', async (ctx) => {
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    // Если ждём username клиента
    if (user?.state === 'waiting_client_username') {
        const text = ctx.message.text;
        
        // Сбрасываем состояние
        await supabase
            .from('users')
            .update({ state: null })
            .eq('telegram_id', ctx.from.id);
        
        if (!text.startsWith('@')) {
            await ctx.reply(
                `❌ Отправь username в формате @username`,
                { reply_markup: new InlineKeyboard().text('🔄 Попробовать снова', 'add_client') }
            );
            return;
        }
        
        const username = text.substring(1);
        
        // Ищем клиента
        const { data: client } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_username', username)
            .single();
        
        if (!client) {
            await ctx.reply(
                `❌ Пользователь @${username} не найден.\n\n` +
                `Убедись, что клиент запустил бота командой /start`,
                { reply_markup: new InlineKeyboard().text('🔄 Попробовать снова', 'add_client') }
            );
            return;
        }
        
        // Проверяем, не добавлен ли уже
        const { data: existing } = await supabase
            .from('trainer_clients')
            .select('*')
            .eq('trainer_id', user.id)
            .eq('client_id', client.id)
            .single();
        
        if (existing) {
            await ctx.reply(
                `⚠️ @${username} уже в твоём списке клиентов.`,
                { reply_markup: new InlineKeyboard().text('📋 Мои клиенты', 'my_clients') }
            );
            return;
        }
        
        // Добавляем связь
        await supabase
            .from('trainer_clients')
            .insert({
                trainer_id: user.id,
                client_id: client.id
            });
        
        await ctx.reply(
            `✅ Клиент добавлен!\n\n` +
            `${client.first_name} ${client.last_name || ''}\n` +
            `@${client.telegram_username}`,
            { 
                reply_markup: new InlineKeyboard()
                    .text('📝 Создать программу', `program_for_${client.id}`)
                    .row()
                    .text('📋 Мои клиенты', 'my_clients')
            }
        );
        return;
    }
    
    // Дефолтный ответ
    await ctx.reply(
        `Используй /start для начала работы с ботом.`
    );
});

app.get('/', (req, res) => res.send('FitTracker Bot OK'));

app.post('/webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
    } catch (e) {
        console.error('Error:', e.message);
    }
    res.send('OK');
});

const PORT = process.env.PORT || 3000;

async function start() {
    await bot.init();
    console.log('Bot initialized:', bot.botInfo.username);
    
    app.listen(PORT, () => console.log('Server on port', PORT));
    
    await bot.api.setWebhook(process.env.WEBAPP_URL + '/webhook');
    console.log('Webhook set');
}

start().catch(console.error);
