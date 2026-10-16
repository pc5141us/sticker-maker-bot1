import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import https from 'https';
import { config } from './config.js';
import { handleStart, handleHelp, handleApp, sendAppApk } from './handlers/commands.js';
import { handleSingleSticker } from './handlers/sticker.js';
import { handlePackConversion } from './handlers/pack.js';
import { extractPackName } from './utils/helpers.js';

let botInstance: Telegraf | null = null;

// وكيل HTTPS محسن فائق الاستجابة لمنع تجمد الاتصال وحل مشكلة بطء الاستجابة بعد الخمول
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 20000
});

export function createBot(): Telegraf {
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

  // تحسين سرعة استقبال الرسائل بعد فترات الخمول:
  // افتراضياً تليجرام ينتظر 50 ثانية في getUpdates مما يجعل المقبس (Socket) يتجمد عند انقطاع الشبكة أو خمول الجهاز
  // نضبط مهلة الاستطلاع إلى 10 ثوانٍ لضمان تدفق البيانات بشكل دائم وسريع
  const originalCallApi = bot.telegram.callApi.bind(bot.telegram);
  (bot.telegram as any).callApi = function (method: string, data: any, abortController?: any) {
    if (method === 'getUpdates' && data && typeof data === 'object') {
      data.timeout = 10;
    }
    return (originalCallApi as any)(method, data, abortController);
  };

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

  // 2. أوامر تحميل التطبيق مباشرة
  bot.command(['app', 'apk', 'download', 'program'], handleApp);

  // زر التفاعل الداخلي لتحميل التطبيق (Inline Callback)
  bot.action('download_app', async (ctx) => {
    await ctx.answerCbQuery('📲 جاري إرسال التطبيق...').catch(() => {});
    await sendAppApk(ctx);
  });

  // 3. أمر الحزمة اليدوي /pack
  bot.command('pack', async (ctx) => {
    const text = ctx.message.text.replace(/^\/pack(@\w+)?/i, '').trim();
    if (!text) {
      await ctx.reply('ℹ️ يرجى إدخال اسم الحزمة أو رابطها بعد الأمر، مثال:\n`/pack Animals`', { parse_mode: 'Markdown' });
      return;
    }
    await handlePackConversion(ctx, text);
  });

  // 4. استقبال الاستكرات الفردية وحزم الاستكرات تلقائياً
  bot.on(message('sticker'), handleSingleSticker);

  // 5. استقبال النصوص (للتحقق مما إذا كان المستخدم أرسل رابط حزمة أو يطلب التطبيق)
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // تجاهل الأوامر غير المعروفة

    // الاستجابة لطلبات تحميل التطبيق بالنصوص الطبيعية
    const appKeywords = [
      'تحميل التطبيق', 'تحميل البرنامج', 'تنزيل التطبيق', 'تنزيل البرنامج',
      'عايز البرنامج', 'عاوز البرنامج', 'عايز التطبيق', 'عاوز التطبيق',
      'ارسل البرنامج', 'ابعت البرنامج', 'ارسل التطبيق', 'ابعت التطبيق',
      'تطبيق', 'برنامج', 'apk', 'app'
    ];
    const isAppRequest = appKeywords.some(keyword => text.toLowerCase().includes(keyword));
    if (isAppRequest) {
      await sendAppApk(ctx);
      return;
    }

    const packName = extractPackName(text);
    if (packName) {
      await handlePackConversion(ctx, text);
    } else {
      await ctx.reply(
        '💡 <b>طريقة استخدام البوت:</b>\n\n' +
        '• أرسل أي استكر مباشرة وسيقوم البوت بتحويل الحزمة كاملة لواتساب.\n' +
        '• أو أرسل رابط حزمة تليجرام لتحويلها فوراً.\n' +
        '• للمساعدة والشرح: /help\n' +
        '• لتحميل تطبيق الأندرويد: /app أو اضغط على الزر أدناه.',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📲 تحميل تطبيق Sticker Maker US (APK)', 'download_app')]
          ])
        }
      );
    }
  });

  // معالجة الأخطاء غير المتوقعة لمنع توقف البوت
  bot.catch((err: any, ctx) => {
    console.error(`❌ خطأ أثناء معالجة التحديث ${ctx.update?.update_id}:`, err);
  });

  botInstance = bot;
  return bot;
}
