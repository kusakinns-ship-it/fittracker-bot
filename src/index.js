require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Bot, InlineKeyboard, webhookCallback } = require('grammy');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
const path = require('path');

// =============================================
// ИНИЦИАЛИЗАЦИЯ
// =============================================

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Telegram Bot
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// =============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =============================================

async function getOrCreateUser(telegramUser) {
    const { data: existingUser } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramUser.id)
        .single();
    
    if (existingUser) {
        return existingUser;
    }
    
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
    
    if (error) {
        console.error('Error creating user:', error);
        return null;
    }
    
    return newUser;
}

async function parseTrainingWithAI(text) {
    const systemPrompt = `Ты парсер тренировочных программ. Преобразуй текст тренировки в JSON.

ПРАВИЛА:
- "135 × 5×5" = вес 135, повторений 5, подходов 5
- "BW × 12×4" = собственный вес, повторений 12, подходов 4
- "(+2.5 кг)" = добавочный вес
- "HS" или "HEAVY SINGLE" = тяжёлый синглтон
- "RPE: 8-9" = целевая интенсивность

Верни JSON:
{
  "day_name": "название дня",
  "focus": "фокус тренировки",
  "exercises": [
    {
      "name": "название",
      "sets": 5,
      "reps": "5",
      "weight": 135,
      "rest_seconds": 300,
      "rpe_min": 8,
      "rpe_max": 9,
      "warmup_sets": [{"weight": 40, "reps": 10}, ...],
      "heavy_single": {"weight": 145, "reps": 1},
      "technique_notes": ["заметка 1", ...],
      "notes": "доп. инфо"
    }
  ]
}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Распарси эту тренировку:\n\n${text}` }
            ],
            response_format: { type: 'json_object' }
        });
        
        return JSON.parse(response.choices[0].message.content);
    } catch (error) {
        console.error('AI parsing error:', error);
        return null;
    }
}

async function analyzeWorkoutAndSuggestProgression(workout, history) {
    const systemPrompt = `Ты опытный тренер по силовым видам спорта. 
Анализируй выполненную тренировку и предложи прогрессию на следующую неделю.
Безопасность клиента превыше всего.

Правила прогрессии:
- Если RPE < 8 и все повторения выполнены → можно +2.5-5 кг
- Если RPE = 8-9 и все повторения выполнены → держим вес, можно +1 подход
- Если RPE > 9 или повторения не выполнены → держим или снижаем вес
- Учитывай комментарии клиента

Верни JSON:
{
  "analysis": "краткий анализ тренировки",
  "recommendations": ["рекомендация 1", ...],
  "next_week": {
    "exercises": [
      {
        "name": "название",
        "sets": 5,
        "reps": "5", 
        "weight": 137.5,
        "change": "+2.5 кг",
        "reason": "почему такое изменение"
      }
    ]
  }
}`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Тренировка:\n${JSON.stringify(workout)}\n\nИстория:\n${JSON.stringify(history)}` }
            ],
            response_format: { type: 'json_object' }
        });
        
        return JSON.parse(response.choices[0].message.content);
    } catch (error) {
        console.error('AI analysis error:', error);
        return null;
    }
}

// =============================================
// TELEGRAM BOT HANDLERS
// =============================================

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
        `Отлично! Ты зарегистрирован как клиент.\n\n` +
        `Что хочешь сделать?`,
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
        `Отлично! Ты зарегистрирован как тренер.\n\n` +
        `Твой тариф: Старт (бесплатно)\n` +
        `Клиентов: 0/3\n\n` +
        `Что хочешь сделать?`,
        { reply_markup: keyboard }
    );
});

// Добавить клиента
bot.callbackQuery('add_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await ctx.editMessageText(
        `Чтобы добавить клиента, отправь его @username в Telegram.\n\n` +
        `Например: @ivan_petrov\n\n` +
        `Клиент должен сначала запустить этого бота.`,
        { 
            reply_markup: new InlineKeyboard()
                .text('« Назад', 'role_trainer') 
        }
    );
    
    // Устанавливаем состояние ожидания username
    await supabase
        .from('users')
        .update({ notes: 'waiting_client_username' })
        .eq('telegram_id', ctx.from.id);
});

// Обработка текстовых сообщений
bot.on('message:text', async (ctx) => {
    const user = await getOrCreateUser(ctx.from);
    
    // Проверяем, ждём ли мы username клиента
    if (user.role === 'trainer') {
        const text = ctx.message.text;
        
        // Если это @username
        if (text.startsWith('@')) {
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
                    `Убедись, что клиент запустил бота командой /start`
                );
                return;
            }
            
            // Добавляем связь тренер-клиент
            const { error } = await supabase
                .from('trainer_clients')
                .insert({
                    trainer_id: user.id,
                    client_id: client.id
                });
            
            if (error && error.code === '23505') {
                await ctx.reply(`⚠️ @${username} уже в твоём списке клиентов.`);
                return;
            }
            
            await ctx.reply(
                `✅ Клиент @${username} добавлен!\n\n` +
                `${client.first_name} ${client.last_name || ''}\n\n` +
                `Теперь ты можешь создать для него программу тренировок.`,
                {
                    reply_markup: new InlineKeyboard()
                        .text('📝 Создать программу', `create_program_${client.id}`)
                }
            );
            return;
        }
        
        // Если это текст программы тренировки
        if (text.includes('×') || text.includes('РАЗМИНКА') || text.includes('РАБОЧИЕ')) {
            await ctx.reply('⏳ Анализирую программу...');
            
            const parsed = await parseTrainingWithAI(text);
            
            if (parsed) {
                // Сохраняем во временное хранилище
                await supabase
                    .from('users')
                    .update({ 
                        notes: JSON.stringify({ 
                            pending_program: parsed,
                            raw_text: text 
                        })
                    })
                    .eq('telegram_id', ctx.from.id);
                
                let preview = `✅ Программа распознана!\n\n`;
                preview += `📋 ${parsed.day_name || 'Тренировка'}\n`;
                preview += `🎯 ${parsed.focus || ''}\n\n`;
                
                parsed.exercises?.forEach((ex, i) => {
                    preview += `${i + 1}. ${ex.name}\n`;
                    preview += `   ${ex.weight || 'BW'} кг × ${ex.reps} × ${ex.sets}\n`;
                });
                
                preview += `\nВсё верно?`;
                
                await ctx.reply(preview, {
                    reply_markup: new InlineKeyboard()
                        .text('✅ Да, сохранить', 'confirm_program')
                        .text('❌ Отмена', 'cancel_program')
                });
            } else {
                await ctx.reply(
                    '❌ Не удалось распознать программу.\n\n' +
                    'Попробуй отправить в формате:\n' +
                    '1️⃣ УПРАЖНЕНИЕ\n' +
                    'ВЕС × ПОВТОРЫ × ПОДХОДЫ'
                );
            }
            return;
        }
    }
    
    // Дефолтный ответ
    await ctx.reply(
        'Используй команды:\n\n' +
        '/start - Начать\n' +
        '/workout - Текущая тренировка\n' +
        '/progress - Мой прогресс'
    );
});

// Подтверждение программы
bot.callbackQuery('confirm_program', async (ctx) => {
    await ctx.answerCallbackQuery('Сохранено!');
    
    // Получаем данные
    const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', ctx.from.id)
        .single();
    
    const programData = JSON.parse(user.notes || '{}');
    
    // Очищаем временные данные
    await supabase
        .from('users')
        .update({ notes: null })
        .eq('telegram_id', ctx.from.id);
    
    await ctx.editMessageText(
        '✅ Программа сохранена!\n\n' +
        'Выбери клиента для назначения:',
        {
            reply_markup: new InlineKeyboard()
                .text('📋 Выбрать клиента', 'select_client_for_program')
                .row()
                .text('💾 Сохранить как шаблон', 'save_as_template')
        }
    );
});

// Список клиентов тренера
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
                id,
                first_name,
                last_name,
                telegram_username
            )
        `)
        .eq('trainer_id', user.id)
        .eq('status', 'active');
    
    if (!clients || clients.length === 0) {
        await ctx.editMessageText(
            'У тебя пока нет клиентов.\n\n' +
            'Добавь первого клиента по его @username.',
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
        `📋 Твои клиенты (${clients.length}):`,
        { reply_markup: keyboard }
    );
});

// Прогресс клиента
bot.callbackQuery('my_progress', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await ctx.editMessageText(
        '📊 Твой прогресс\n\n' +
        'Открой приложение для просмотра графиков и статистики.',
        {
            reply_markup: new InlineKeyboard()
                .webApp('📈 Открыть статистику', `${process.env.WEBAPP_URL}/progress`)
                .row()
                .text('« Назад', 'role_client')
        }
    );
});

// ИИ-создание программы
bot.callbackQuery('ai_program', async (ctx) => {
    await ctx.answerCallbackQuery();
    
    await ctx.editMessageText(
        '🤖 Создание программы с ИИ\n\n' +
        'Опиши свою цель и уровень подготовки:\n\n' +
        'Пример: "Хочу увеличить силу в становой тяге. ' +
        'Тренируюсь 3 раза в неделю, уровень средний, ' +
        'текущий максимум 150 кг"',
        {
            reply_markup: new InlineKeyboard()
                .text('« Назад', 'role_client')
        }
    );
});

// =============================================
// API ENDPOINTS
// =============================================

// Получить данные пользователя
app.get('/api/user/:telegramId', async (req, res) => {
    const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', req.params.telegramId)
        .single();
    
    if (error) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(data);
});

// Получить текущую тренировку
app.get('/api/workout/:userId', async (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    
    const { data, error } = await supabase
        .from('workouts')
        .select(`
            *,
            workout_exercises (
                *,
                exercise:exercise_id (*),
                workout_sets (*)
            )
        `)
        .eq('user_id', req.params.userId)
        .gte('scheduled_date', today)
        .order('scheduled_date')
        .limit(1)
        .single();
    
    if (error) {
        return res.status(404).json({ error: 'No workout found' });
    }
    
    res.json(data);
});

// Сохранить подход
app.post('/api/workout/set', async (req, res) => {
    const { workout_exercise_id, set_number, actual_weight, actual_reps, rpe, comment } = req.body;
    
    const { data, error } = await supabase
        .from('workout_sets')
        .upsert({
            workout_exercise_id,
            set_number,
            actual_weight,
            actual_reps,
            rpe,
            comment,
            completed: true
        })
        .select()
        .single();
    
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    
    res.json(data);
});

// Завершить тренировку
app.post('/api/workout/:workoutId/complete', async (req, res) => {
    const { client_feedback, overall_rpe } = req.body;
    
    // Получаем тренировку с подходами
    const { data: workout } = await supabase
        .from('workouts')
        .select(`
            *,
            workout_exercises (
                *,
                workout_sets (*)
            )
        `)
        .eq('id', req.params.workoutId)
        .single();
    
    // Считаем общий тоннаж
    let totalVolume = 0;
    workout.workout_exercises?.forEach(ex => {
        ex.workout_sets?.forEach(set => {
            if (set.completed && set.actual_weight && set.actual_reps) {
                totalVolume += set.actual_weight * set.actual_reps;
            }
        });
    });
    
    // Обновляем тренировку
    const { data, error } = await supabase
        .from('workouts')
        .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            total_volume: totalVolume,
            overall_rpe,
            client_feedback
        })
        .eq('id', req.params.workoutId)
        .select()
        .single();
    
    if (error) {
        return res.status(500).json({ error: error.message });
    }
    
    // Анализ ИИ и создание следующей тренировки (асинхронно)
    analyzeAndCreateNextWorkout(workout);
    
    res.json(data);
});

async function analyzeAndCreateNextWorkout(completedWorkout) {
    // Получаем историю
    const { data: history } = await supabase
        .from('workouts')
        .select('*')
        .eq('user_id', completedWorkout.user_id)
        .eq('day_of_week', completedWorkout.day_of_week)
        .order('scheduled_date', { ascending: false })
        .limit(4);
    
    // Анализируем с ИИ
    const analysis = await analyzeWorkoutAndSuggestProgression(completedWorkout, history);
    
    if (analysis) {
        // Сохраняем анализ
        await supabase
            .from('workouts')
            .update({
                ai_analysis: analysis.analysis,
                ai_recommendations: JSON.stringify(analysis.recommendations)
            })
            .eq('id', completedWorkout.id);
        
        // Создаём тренировку на следующую неделю
        const nextDate = new Date(completedWorkout.scheduled_date);
        nextDate.setDate(nextDate.getDate() + 7);
        
        // TODO: Создать новую тренировку с обновлёнными весами
    }
    
    // Отправляем уведомление тренеру
    if (completedWorkout.trainer_id) {
        const { data: trainer } = await supabase
            .from('users')
            .select('telegram_id')
            .eq('id', completedWorkout.trainer_id)
            .single();
        
        if (trainer) {
            try {
                await bot.api.sendMessage(
                    trainer.telegram_id,
                    `✅ Клиент завершил тренировку!\n\n` +
                    `📊 Тоннаж: ${completedWorkout.total_volume} кг\n` +
                    `💪 RPE: ${completedWorkout.overall_rpe}\n\n` +
                    `${completedWorkout.client_feedback ? `💬 "${completedWorkout.client_feedback}"` : ''}`
                );
            } catch (e) {
                console.error('Failed to notify trainer:', e);
            }
        }
    }
}

// Получить прогресс по упражнению
app.get('/api/progress/:userId/:exerciseId', async (req, res) => {
    const { data, error } = await supabase
        .from('workout_sets')
        .select(`
            actual_weight,
            actual_reps,
            rpe,
            created_at,
            workout_exercise:workout_exercise_id (
                workout:workout_id (
                    scheduled_date,
                    week_number
                )
            )
        `)
        .eq('workout_exercise.exercise_id', req.params.exerciseId)
        .eq('workout_exercise.workout.user_id', req.params.userId)
        .eq('set_type', 'working')
        .eq('completed', true)
        .order('created_at', { ascending: true });
    
    res.json(data || []);
});

// Библиотека упражнений
app.get('/api/exercises', async (req, res) => {
    const { data } = await supabase
        .from('exercises')
        .select('*')
        .eq('is_public', true)
        .order('name');
    
    res.json(data || []);
});

// =============================================
// TELEGRAM WEBHOOK (для Railway)
// =============================================

if (process.env.NODE_ENV === 'production') {
    app.use('/webhook', webhookCallback(bot, 'express'));
}

// =============================================
// ЗАПУСК СЕРВЕРА
// =============================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`🚀 Server running on port ${PORT}`);
    
    if (process.env.NODE_ENV === 'production') {
        // Устанавливаем webhook
        const webhookUrl = `${process.env.WEBAPP_URL}/webhook`;
        await bot.api.setWebhook(webhookUrl);
        console.log(`🔗 Webhook set to ${webhookUrl}`);
    } else {
        // Локально используем polling
        bot.start();
        console.log('🤖 Bot started with polling');
    }
});
