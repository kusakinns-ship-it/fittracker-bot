const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');

const app = express();

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
    console.log('START command received');
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

// Webhook без middleware
app.post('/webhook', (req, res) => {
    console.log('Webhook hit');
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            console.log('Body received:', body.substring(0, 100));
            const update = JSON.parse(body);
            await bot.handleUpdate(update);
            res.sendStatus(200);
        } catch (e) {
            console.error('Webhook error:', e.message);
            res.sendStatus(200);
        }
    });
});

app.get('/', (req, res) => res.send('FitTracker Bot is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log('Server started on port', PORT);
    const url = process.env.WEBAPP_URL + '/webhook';
    console.log('Setting webhook to:', url);
    await bot.api.setWebhook(url);
    console.log('Webhook set successfully');
});
