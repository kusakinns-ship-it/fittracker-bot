const express = require('express');
const { Bot, InlineKeyboard } = require('grammy');

const app = express();
app.use(express.json());

console.log('Starting app...');
console.log('BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
console.log('WEBAPP_URL:', process.env.WEBAPP_URL);

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

bot.command('start', async (ctx) => {
    console.log('START from user:', ctx.from.id);
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
    console.log('GET /');
    res.send('FitTracker Bot OK');
});

app.post('/webhook', async (req, res) => {
    console.log('POST /webhook received');
    console.log('Body:', JSON.stringify(req.body).substring(0, 200));
    try {
        await bot.handleUpdate(req.body);
        console.log('Update handled');
        res.sendStatus(200);
    } catch (err) {
        console.error('Error handling update:', err.message);
        res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 3000;
console.log('Will listen on port:', PORT);

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
    try {
        const webhookUrl = `${process.env.WEBAPP_URL}/webhook`;
        console.log('Setting webhook to:', webhookUrl);
        await bot.api.setWebhook(webhookUrl);
        console.log('Webhook set OK');
    } catch (err) {
        console.error('Webhook error:', err.message);
    }
});
