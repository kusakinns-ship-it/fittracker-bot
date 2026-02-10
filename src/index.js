const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');

const app = express();
app.use(express.json());

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
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

app.post('/webhook', express.json(), async (req, res) => {
    try {
        await bot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (e) {
        console.error('Error:', e);
        res.sendStatus(200);
    }
});

app.get('/', (req, res) => res.send('FitTracker Bot'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log('Server started on port', PORT);
    await bot.api.setWebhook(process.env.WEBAPP_URL + '/webhook');
    console.log('Webhook set');
});
