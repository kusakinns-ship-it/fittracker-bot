const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');

const app = express();
app.use(express.json());

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
    console.log('START');
    await ctx.reply('Привет! Бот работает! 🎉');
});

app.get('/', (req, res) => {
    console.log('GET /');
    res.send('OK');
});

app.post('/webhook', async (req, res) => {
    console.log('WEBHOOK');
    try {
        await bot.handleUpdate(req.body);
    } catch (e) {
        console.log('ERR:', e.message);
    }
    res.send('OK');
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log('Listening on port', PORT);
});

// Установка webhook после запуска
setTimeout(async () => {
    try {
        await bot.api.setWebhook(process.env.WEBAPP_URL + '/webhook');
        console.log('Webhook set');
    } catch (e) {
        console.log('Webhook error:', e.message);
    }
}, 1000);
