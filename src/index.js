const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// Получить или создать пользователя (тренера)
async function getOrCreateUser(telegramUser) {
    const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramUser.id)
        .single();
    
    if (existing) return existing;
    
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
    return newUser;
}

// /start
bot.command('start', async (ctx) => {
    console.log('START from', ctx.from.id);
    await getOrCreateUser(ctx.from);
    
    // Проверяем, может это клиент с привязкой
    const { data: clientLink } = await supabase
        .from('trainer_clients')
        .select('*, trainer:trainer_id(first_name)')
        .eq('client_telegram_id', ctx.from.id)
        .single();
    
    if (clientLink) {
        // Это клиент тренера — режим просмотра
        const keyboard = new InlineKeyboard()
            .text('📋 Моя тренировка', 'view_my_workout')
            .row()
            .text('📊 Мой прогресс', 'view_my_progress');
        
        await ctx.reply(
            `Привет, ${ctx.from.first_name}! 👋\n\n` +
            `Твой тренер: ${clientLink.trainer?.first_name || 'Не указан'}\n\n` +
            `Здесь ты можешь просматривать свои тренировки.`,
            { reply_markup: keyboard }
        );
        return;
    }
    
    const keyboard = new InlineKeyboard()
        .text('🏋️ Я тренер', 'role_trainer');
    
    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\n` +
        `Добро пожаловать в FitTracker — помощник для тренеров.\n\n` +
        `Этот бот создан для тренеров. Если ты клиент — попроси своего тренера дать тебе доступ.`,
        { reply_markup: keyboard }
    );
});

// Тренер
bot.callbackQuery('role_trainer', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await supabase
        .from('users')
        .update({ role: 'trainer' })
        .eq('telegram_id', ctx.from.id);
    
    await showTrainerMenu(ctx);
});

async function showTrainerMenu(ctx, edit = true) {
    const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    const { count } = await supabase
        .from('trainer_clients')
        .select('*', { count: 'exact', head: true })
        .eq('trainer_id', user?.id)
        .eq('status', 'active');
    
    const keyboard = new InlineKeyboard()
        .text('➕ Добавить клиента', 'add_client')
        .row()
        .text('📋 Мои клиенты', 'my_clients')
        .row()
        .text('⚙️ Настройки', 'settings');
    
    const text = `🏋️ FitTracker — Панель тренера\n\n` +
        `Тариф: Старт (бесплатно)\n` +
        `Клиентов: ${count || 0}/3\n\n` +
        `Выбери действие:`;
    
    if (edit && ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: keyboard });
    } else {
        await ctx.reply(text, { reply_markup: keyboard });
    }
}

// Добавить клиента
bot.callbackQuery('add_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await supabase
        .from('users')
        .update({ state: 'adding_client_name' })
        .eq('telegram_id', ctx.from.id);
    
    await ctx.editMessageText(
        `➕ Добавление клиента\n\n` +
        `Шаг 1/2: Введи имя клиента\n\n` +
        `Например: Иван Петров`,
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
        .select('*')
        .eq('trainer_id', user?.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
    
    if (!clients || clients.length === 0) {
        await ctx.editMessageText(
            `📋 Мои клиенты\n\n` +
            `У тебя пока нет клиентов.\n\n` +
            `Нажми "Добавить клиента" чтобы создать первого.`,
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
    clients.forEach((client) => {
        const linked = client.client_telegram_id ? '🔗' : '';
        keyboard.text(`${linked} ${client.client_name}`, `client_${client.id}`).row();
    });
    keyboard.text('« Назад', 'role_trainer');
    
    await ctx.editMessageText(
        `📋 Мои клиенты (${clients.length})\n\n` +
        `🔗 — клиент с доступом в бот\n\n` +
        `Выбери клиента:`,
        { reply_markup: keyboard }
    );
});

// Карточка клиента
bot.callbackQuery(/^client_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    
    const clientId = ctx.match[1];
    
    const { data: client } = await supabase
        .from('trainer_clients')
        .select('*')
        .eq('id', clientId)
        .single();
    
    if (!client) {
        await ctx.editMessageText('Клиент не найден');
        return;
    }
    
    const linkedStatus = client.client_telegram_id 
        ? `✅ Привязан (@${client.client_telegram_username || 'username'})` 
        : '❌ Не привязан';
    
    const keyboard = new InlineKeyboard()
        .text('📝 Программа', `program_${clientId}`)
        .text('📊 Прогресс', `progress_${clientId}`)
        .row()
        .text('📏 Замеры', `metrics_${clientId}`)
        .row();
    
    if (!client.client_telegram_id) {
        keyboard.text('🔗 Дать доступ клиенту', `link_client_${clientId}`).row();
    } else {
        keyboard.text('🔓 Отвязать доступ', `unlink_client_${clientId}`).row();
    }
    
    keyboard
        .text('✏️ Редактировать', `edit_client_${clientId}`)
        .text('🗑 Удалить', `delete_client_${clientId}`)
        .row()
        .text('« Назад', 'my_clients');
    
    await ctx.editMessageText(
        `👤 ${client.client_name}\n\n` +
        `📱 Доступ в бот: ${linkedStatus}\n` +
        `📅 Добавлен: ${new Date(client.created_at).toLocaleDateString('ru')}\n` +
        `${client.notes ? `📝 Заметки: ${client.notes}` : ''}`,
        { reply_markup: keyboard }
    );
});

// Дать доступ клиенту
bot.callbackQuery(/^link_client_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    
    const clientId = ctx.match[1];
    
    await supabase
        .from('users')
        .update({ 
            state: 'linking_client',
            temp_data: clientId
        })
        .eq('telegram_id', ctx.from.id);
    
    await ctx.editMessageText(
        `🔗 Привязка доступа\n\n` +
        `Отправь @username клиента в Telegram.\n\n` +
        `После привязки клиент сможет:\n` +
        `• Просматривать свою программу\n` +
        `• Видеть свой прогресс\n\n` +
        `⚠️ Клиент должен сначала написать боту /start`,
        { reply_markup: new InlineKeyboard().text('« Отмена', `client_${clientId}`) }
    );
});

// Отвязать доступ
bot.callbackQuery(/^unlink_client_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    
    const clientId = ctx.match[1];
    
    await supabase
        .from('trainer_clients')
        .update({ 
            client_telegram_id: null,
            client_telegram_username: null
        })
        .eq('id', clientId);
    
    await ctx.answerCallbackQuery('Доступ отвязан');
    
    // Возвращаемся к карточке клиента
    ctx.match[1] = clientId;
    await bot.handleUpdate({
        callback_query: {
            ...ctx.callbackQuery,
            data: `client_${clientId}`
        }
    });
});

// Программа клиента (заглушка)
bot.callbackQuery(/^program_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const clientId = ctx.match[1];
    
    await ctx.editMessageText(
        `📝 Программа тренировок\n\n` +
        `Здесь будет программа клиента.\n\n` +
        `Отправь программу текстом в формате:\n\n` +
        `📅 ПОНЕДЕЛЬНИК - ПРИСЕД\n` +
        `1️⃣ Приседания 100×5×5\n` +
        `2️⃣ Жим ногами 80×10×4`,
        { reply_markup: new InlineKeyboard().text('« Назад', `client_${clientId}`) }
    );
});

// Прогресс клиента (заглушка)
bot.callbackQuery(/^progress_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const clientId = ctx.match[1];
    
    await ctx.editMessageText(
        `📊 Прогресс клиента\n\n` +
        `Скоро здесь появятся графики!`,
        { reply_markup: new InlineKeyboard().text('« Назад', `client_${clientId}`) }
    );
});

// Замеры клиента (заглушка)
bot.callbackQuery(/^metrics_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const clientId = ctx.match[1];
    
    await ctx.editMessageText(
        `📏 Замеры и метрики\n\n` +
        `Скоро здесь можно будет вносить вес, замеры тела и данные InBody.`,
        { reply_markup: new InlineKeyboard().text('« Назад', `client_${clientId}`) }
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
    
    await ctx.editMessageText(
        `⚙️ Настройки\n\n` +
        `👤 ${user?.first_name || ''} ${user?.last_name || ''}\n` +
        `📱 @${user?.telegram_username || 'не указан'}\n` +
        `💎 Тариф: Free\n\n` +
        `Для смены тарифа напиши @support`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'role_trainer') }
    );
});

// Просмотр тренировки (для клиента)
bot.callbackQuery('view_my_workout', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `📋 Твоя тренировка на сегодня\n\n` +
        `Тренер пока не назначил тренировку.`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'start') }
    );
});

// Просмотр прогресса (для клиента)
bot.callbackQuery('view_my_progress', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `📊 Твой прогресс\n\n` +
        `Данные появятся после первых тренировок.`,
        { reply_markup: new InlineKeyboard().text('« Назад', 'start') }
    );
});

// Назад к старту (для клиента)
bot.callbackQuery('start', async (ctx) => {
    await ctx.answerCallbackQuery();
    // Имитируем /start
    await bot.handleUpdate({
        message: {
            ...ctx.callbackQuery.message,
            text: '/start',
            from: ctx.from
        }
    });
});

// Обработка текстовых сообщений
bot.on('message:text', async (ctx) => {
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    if (!user) {
        await ctx.reply('Напиши /start для начала');
        return;
    }
    
    // Добавление клиента - ввод имени
    if (user.state === 'adding_client_name') {
        const clientName = ctx.message.text.trim();
        
        if (clientName.length < 2) {
            await ctx.reply('Имя слишком короткое. Попробуй ещё раз.');
            return;
        }
        
        // Создаём клиента
        const { data: newClient, error } = await supabase
            .from('trainer_clients')
            .insert({
                trainer_id: user.id,
                client_name: clientName,
                status: 'active'
            })
            .select()
            .single();
        
        // Сбрасываем состояние
        await supabase
            .from('users')
            .update({ state: null })
            .eq('telegram_id', ctx.from.id);
        
        if (error) {
            await ctx.reply('Ошибка при создании клиента. Попробуй ещё раз.');
            return;
        }
        
        await ctx.reply(
            `✅ Клиент "${clientName}" добавлен!\n\n` +
            `Теперь можешь создать для него программу тренировок.`,
            { 
                reply_markup: new InlineKeyboard()
                    .text('📝 Создать программу', `program_${newClient.id}`)
                    .row()
                    .text('📋 Мои клиенты', 'my_clients')
            }
        );
        return;
    }
    
    // Привязка клиента к Telegram
    if (user.state === 'linking_client') {
        const text = ctx.message.text.trim();
        
        if (!text.startsWith('@')) {
            await ctx.reply('Отправь username в формате @username');
            return;
        }
        
        const username = text.substring(1);
        const clientId = user.temp_data;
        
        // Ищем пользователя
        const { data: telegramUser } = await supabase
            .from('users')
            .select('*')
            .eq('telegram_username', username)
            .single();
        
        if (!telegramUser) {
            await ctx.reply(
                `❌ Пользователь @${username} не найден.\n\n` +
                `Клиент должен сначала написать боту /start`,
                { reply_markup: new InlineKeyboard().text('🔄 Попробовать снова', `link_client_${clientId}`) }
            );
            return;
        }
        
        // Привязываем
        await supabase
            .from('trainer_clients')
            .update({
                client_telegram_id: telegramUser.telegram_id,
                client_telegram_username: username
            })
            .eq('id', clientId);
        
        // Сбрасываем состояние
        await supabase
            .from('users')
            .update({ state: null, temp_data: null })
            .eq('telegram_id', ctx.from.id);
        
        await ctx.reply(
            `✅ Доступ выдан!\n\n` +
            `Теперь @${username} может просматривать свою программу в боте.`,
            { reply_markup: new InlineKeyboard().text('👤 К клиенту', `client_${clientId}`) }
        );
        return;
    }
    
    // Дефолт
    await ctx.reply(
        'Используй меню для навигации.',
        { reply_markup: new InlineKeyboard().text('🏠 Главное меню', 'role_trainer') }
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
