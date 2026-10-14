import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from './config.js';
import { handleStart, handleHelp } from './handlers/commands.js';
import { handleSingleSticker } from './handlers/sticker.js';
import { handlePackConversion } from './handlers/pack.js';
import { extractPackName } from './utils/helpers.js';
let botInstance = null;
export function createBot() {
    if (botInstance) {
        return botInstance;
    }
    if (!config.botToken) {
        throw new Error('لم يتم العثور على BOT_TOKEN في المتغيرات البيئية.');
    }
    const bot = new Telegraf(config.botToken, {
        handlerTimeout: 900_000 // 15 دقيقة لمنع انتهاء المهلة في الحزم الكبيرة
    });
    // 1. الأوامر الأساسية
    bot.start(handleStart);
    bot.help(handleHelp);
    // 2. أمر الحزمة اليدوي /pack
    bot.command('pack', async (ctx) => {
        const text = ctx.message.text.replace(/^\/pack(@\w+)?/i, '').trim();
        if (!text) {
            await ctx.reply('ℹ️ يرجى إدخال اسم الحزمة أو رابطها بعد الأمر، مثال:\n`/pack Animals`', { parse_mode: 'Markdown' });
            return;
        }
        await handlePackConversion(ctx, text);
    });
    // 3. استقبال الاستكرات الفردية
    bot.on(message('sticker'), handleSingleSticker);
    // 4. استقبال النصوص (للتحقق مما إذا كان المستخدم أرسل رابط حزمة مباشرة)
    bot.on(message('text'), async (ctx) => {
        const text = ctx.message.text.trim();
        if (text.startsWith('/'))
            return; // تجاهل الأوامر غير المعروفة
        const packName = extractPackName(text);
        if (packName) {
            await handlePackConversion(ctx, text);
        }
        else {
            await ctx.reply('💡 **كيفية الاستخدام:**\n' +
                '• أرسل أي استكر مباشرة لتحويله إلى واتساب.\n' +
                '• أو أرسل رابط حزمة مثل: `https://t.me/addstickers/...` لتحويل الحزمة كاملة.\n' +
                '• للمساعدة: /help', { parse_mode: 'Markdown' });
        }
    });
    // معالجة الأخطاء غير المتوقعة
    bot.catch((err, ctx) => {
        console.error(`خطأ غير متوقع في محادثة ${ctx.update?.update_id}:`, err);
    });
    botInstance = bot;
    return bot;
}
