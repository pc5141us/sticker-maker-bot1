import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import https from 'https';
import { config } from './config.js';
import { handleStart, handleHelp } from './handlers/commands.js';
import { handleSingleSticker } from './handlers/sticker.js';
import { handlePackConversion } from './handlers/pack.js';
import { extractPackName } from './utils/helpers.js';
let botInstance = null;
// وكيل HTTPS بمؤقت زمني لضمان إعادة الاتصال التلقائي في حال انقطاع الشبكة أو نوم الجهاز
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    timeout: 35000
});
export function createBot() {
    if (botInstance) {
        return botInstance;
    }
    if (!config.botToken) {
        throw new Error('لم يتم العثور على BOT_TOKEN في المتغيرات البيئية.');
    }
    const bot = new Telegraf(config.botToken, {
        telegram: {
            agent: httpsAgent
        },
        handlerTimeout: 900_000 // 15 دقيقة لمنع انتهاء المهلة في الحزم الكبيرة
    });
    // تسجيل الأحداث المستلمة للمتابعة المباشرة
    bot.use(async (ctx, next) => {
        const time = new Date().toLocaleTimeString('ar-EG');
        const sender = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'مستخدم');
        if (ctx.message) {
            const msgType = 'sticker' in ctx.message ? '🎨 استكر' : 'text' in ctx.message ? `💬 نص: ${ctx.message.text}` : '📁 ملف';
            console.log(`[${time}] استلام ${msgType} من ${sender}`);
        }
        return next();
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
    // 3. استقبال الاستكرات الفردية وحزم الاستكرات تلقائياً
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
            await ctx.reply('💡 <b>طريقة استخدام البوت:</b>\n' +
                '• أرسل أي استكر مباشرة وسيقوم البوت بتحويل الحزمة كاملة لواتساب.\n' +
                '• أو أرسل رابط حزمة تليجرام لتحويلها فوراً.\n' +
                '• للمساعدة والشرح: /help', { parse_mode: 'HTML' });
        }
    });
    // معالجة الأخطاء غير المتوقعة لمنع توقف البوت
    bot.catch((err, ctx) => {
        console.error(`❌ خطأ أثناء معالجة التحديث ${ctx.update?.update_id}:`, err);
    });
    botInstance = bot;
    return bot;
}
