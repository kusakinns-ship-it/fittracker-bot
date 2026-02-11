const express = require('express');
const path = require('path');
const { Bot, InlineKeyboard } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// /start
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
        `Привет, ${ctx.from.first_name}! 👋\n\n` +
        `Добро пожаловать в FitTracker — помощник для фитнес-тренеров.\n\n` +
        `Нажми кнопку ниже:`,
        { reply_markup: keyboard }
    );
});

// ============ API ============

// Получить пользователя
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
app.get('/api/clients/:trainerId', async (req, res) => {
    const { data } = await supabase
        .from('trainer_clients')
        .select('*')
        .eq('trainer_id', req.params.trainerId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
    
    res.json(data || []);
});

// Создать клиента
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

// Получить программу клиента
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

// Парсинг программы через OpenAI
app.post('/api/parse-program', async (req, res) => {
    const { client_id, text } = req.body;
    
    if (!text) {
        return res.status(400).json({ error: 'Text required' });
    }
    
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: `Ты парсер программ тренировок. Преобразуй текст программы в JSON.

Формат ответа (строго JSON, без markdown):
{
  "name": "Название программы",
  "days_per_week": 3,
  "days": [
    {
      "name": "День 1 - Присед",
      "day_of_week": 1,
      "exercises": [
        {
          "name": "Приседания со штангой",
          "sets": 5,
          "reps": "5",
          "weight": 100,
          "rest": "3 мин",
          "tempo": null,
          "notes": null
        }
      ]
    }
  ]
}

Правила парсинга:
- "100×5×5" или "100 5х5" = вес 100кг, 5 повторений, 5 подходов
- "5×5" без веса = 5 повторений, 5 подходов, вес null
- "8-12" в повторениях = записать как "8-12"
- Если есть эмодзи дней (📅), разбивай по дням
- Если нет явного разделения на дни — создай один день
- Названия упражнений приводи к нормальному виду
- Отвечай ТОЛЬКО JSON, без пояснений`
                },
                {
                    role: 'user',
                    content: text
                }
            ],
            temperature: 0.1
        });
        
        let jsonStr = completion.choices[0].message.content;
        
        // Убираем markdown если есть
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const program = JSON.parse(jsonStr);
        
        // Сохраняем в базу
        const { data: savedProgram, error } = await supabase
            .from('programs')
            .upsert({
                client_id: client_id,
                name: program.name || 'Программа',
                days_per_week: program.days_per_week || program.days?.length || 1,
                days: program.days || [],
                is_active: true
            }, {
                onConflict: 'client_id',
                ignoreDuplicates: false
            })
            .select()
            .single();
        
        if (error) {
            console.error('DB error:', error);
            // Если ошибка — пробуем insert
            const { data: insertedProgram, error: insertError } = await supabase
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
            
            if (insertError) {
                return res.status(500).json({ error: insertError.message });
            }
            return res.json(insertedProgram);
        }
        
        res.json(savedProgram);
        
    } catch (e) {
        console.error('Parse error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Сохранить программу
app.post('/api/program', async (req, res) => {
    const { client_id, name, days_per_week, days } = req.body;
    
    // Деактивируем старые программы
    await supabase
        .from('programs')
        .update({ is_active: false })
        .eq('client_id', client_id);
    
    const { data, error } = await supabase
        .from('programs')
        .insert({
            client_id,
            name,
            days_per_week,
            days,
            is_active: true
        })
        .select()
        .single();
    
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
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
