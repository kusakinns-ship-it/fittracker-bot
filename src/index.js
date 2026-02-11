const express = require('express');
const path = require('path');
const { Bot, InlineKeyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
    console.log('START from', ctx.from.id);
    
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
    
    const keyboard = new InlineKeyboard()
        .webApp('🏋️ Открыть FitTracker', process.env.WEBAPP_URL);
    
    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\nДобро пожаловать в FitTracker.\n\nНажми кнопку ниже:`,
        { reply_markup: keyboard }
    );
});

app.get('/api/user/:telegramId', async (req, res) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', req.params.telegramId)
        .single();
    
    if (error) return res.status(404).json({ error: 'User not found' });
    res.json(data);
});

app.get('/api/clients/:trainerId', async (req, res) => {
    const { data } = await supabase
        .from('trainer_clients')
        .select('*')
        .eq('trainer_id', req.params.trainerId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
    
    res.json(data || []);
});

app.post('/api/clients', async (req, res) => {
    const { trainer_id, client_name, goal, notes } = req.body;
    
    const { data, error } = await supabase
        .from('trainer_clients')
        .insert({ trainer_id, client_name, goal, notes, status: 'active' })
        .select()
        .single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.get('/api/program/:clientId', async (req, res) => {
    const { data, error } = await supabase
        .from('programs')
        .select('*')
        .eq('client_id', req.params.clientId)
        .eq('is_active', true)
        .single();
    
    if (error || !data) return res.status(404).json({ error: 'No program' });
    res.json(data);
});

app.post('/api/parse-program', async (req, res) => {
    const { client_id, text } = req.body;
    
    console.log('=== PARSE PROGRAM ===');
    console.log('Client ID:', client_id);
    
    if (!text) {
        return res.status(400).json({ error: 'Text required' });
    }
    
    try {
        const completion = await groq.chat.completions.create({
            model: 'llama-3.1-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: `Ты парсер программ тренировок. Преобразуй текст в JSON.

Формат ответа (ТОЛЬКО JSON, без markdown, без \`\`\`):
{
  "name": "Название программы",
  "days_per_week": 3,
  "days": [
    {
      "name": "День 1 - Присед",
      "exercises": [
        {
          "name": "Приседания со штангой",
          "sets": 5,
          "reps": "5",
          "weight": 100,
          "rest": "3 мин"
        }
      ]
    }
  ]
}

Правила:
- "100×5×5" или "100x5x5" = вес 100, 5 повторений, 5 подходов
- "5×5" без веса = 5 повторений, 5 подходов, weight: null
- Отвечай ТОЛЬКО валидным JSON`
                },
                {
                    role: 'user',
                    content: text
                }
            ],
            temperature: 0.1,
            max_tokens: 2000
        });
        
        let jsonStr = completion.choices[0].message.content;
        console.log('Groq response:', jsonStr.substring(0, 300));
        
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const program = JSON.parse(jsonStr);
        console.log('Parsed:', program.name);
        
        await supabase
            .from('programs')
            .update({ is_active: false })
            .eq('client_id', client_id);
        
        const { data: saved, error: saveError } = await supabase
            .from('programs')
            .insert({
                client_id: client_id,
                name: program.name || 'Программа',
                days_per_week: program.days_per_week || program.days?.length || 1,
                days: program.days || [],
                is_active: true
            })
            .select()
            .single();
        
        if (saveError) {
            console.error('DB error:', saveError);
            return res.status(500).json({ error: saveError.message });
        }
        
        console.log('Saved, ID:', saved.id);
        res.json(saved);
        
    } catch (e) {
        console.error('Parse error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post('/webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
    } catch (e) {
        console.error('Webhook error:', e.message);
    }
    res.send('OK');
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;

async function start() {
    await bot.init();
    console.log('Bot:', bot.botInfo.username);
    app.listen(PORT, () => console.log('Server on port', PORT));
    await bot.api.setWebhook(process.env.WEBAPP_URL + '/webhook');
}

start().catch(console.error);
