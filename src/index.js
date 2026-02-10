const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');

const app = express();
app.use(express.json());

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
    console.log('START from', ctx.from.id);
    const keyboard = new InlineKeyboard()
        .text('👤 Я клиент', 'role_client')
        .text('🏋️ Я тренер', 'role_trainer');
    
    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\nДобро пожаловать в FitTracker!\n\nКто ты?`,
        { reply_markup: keyboard }
    );
});

bot.callbackQuery('role_client', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Отлично! Ты клиент. Скоро тут будет функционал!');
});

bot.callbackQuery('role_trainer', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Отлично! Ты тренер. Скоро тут будет функционал!');
});

app.get('/', (req, res) => {
    res.send('FitTracker Bot OK');
});

app.post('/webhook', async (req, res) => {
    console.log('Webhook received');
    try {
        await bot.handleUpdate(req.body);
        console.log('Update handled OK');
    } catch (e) {
        console.log('ERR:', e.message);
    }
    res.send('OK');
});

const PORT = process.env.PORT || 3000;

async function start() {
    // Инициализируем бота
    await bot.init();
    console.log('Bot initialized:', bot.botInfo.username);
    
    // Запускаем сервер
    app.listen(PORT, () => {
        console.log('Server listening on port', PORT);
    });
    
    // Устанавливаем webhook
    const webhookUrl = process.env.WEBAPP_URL + '/webhook';
    await bot.api.setWebhook(webhookUrl);
    console.log('Webhook set to', webhookUrl);
}

start().catch(console.error);
