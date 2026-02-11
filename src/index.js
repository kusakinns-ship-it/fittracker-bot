const express = require('express');
const path = require('path');
const { Bot, InlineKeyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// /start
bot.command('start', async (ctx) => {
    console.log('START from', ctx.from.id);
    
    // Сохраняем пользователя
    const { data: existing } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    if (!existing) {
        await supabase.from('users').insert({
            telegram_id: ctx.from.id,
            telegram_username: ctx.from.username,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            role: 'trainer'
        });
    }
    
    const webAppUrl = process.env.WEBAPP_URL;
    
    const keyboard = new InlineKeyboard()
        .webApp('🏋️ Открыть FitTracker', webAppUrl);
    
    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\n` +
        `Добро пожаловать в FitTracker — помощник для фитнес-тренеров.\n\n` +
        `Нажми кнопку ниже, чтобы открыть приложение:`,
        { reply_markup: keyboard }
    );
});

// API для Mini App
app.get('/api/user/:telegramId', async (req, res) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', req.params.telegramId)
        .single();
    
    if (error) return res.status(404).json({ error: 'User not found' });
    res.json(data);
});

// Получить клиентов тренера
app.get('/api/clients/:oderId', async (req, res) => {
    const { data } = await supabase
        .from('trainer_clients')
        .select('*')
        .eq('trainer_id', req.params.oderId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
    
    res.json(data || []);
});

// Создать клиента
app.post('/api/clients', async (req, res) => {
    const { trainer_id, client_name, notes } = req.body;
    
    const { data, error } = await supabase
        .from('trainer_clients')
        .insert({ trainer_id, client_name, notes, status: 'active' })
        .select()
        .single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// Удалить клиента
app.delete('/api/clients/:id', async (req, res) => {
    await supabase
        .from('trainer_clients')
        .update({ status: 'archived' })
        .eq('id', req.params.id);
    
    res.json({ success: true });
});

// Webhook
app.post('/webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
    } catch (e) {
        console.error('Error:', e.message);
    }
    res.send('OK');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
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
