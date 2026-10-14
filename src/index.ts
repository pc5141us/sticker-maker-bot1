import { config } from './config.js';
import { createBot } from './bot.js';
import { ensureDir } from './utils/helpers.js';

// منع توقف التطبيق في حال حدوث خطأ غير متوقع
process.on('uncaughtException', (err) => {
  console.error('⚠️ خطأ عام غير معالج (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ رفض غير معالج للوعد (Unhandled Rejection):', reason);
});

async function bootstrap() {
  if (!config.botToken) {
    console.error(`
=====================================================
❌ خطأ: لم يتم العثور على BOT_TOKEN!
يرجى فتح ملف .env وإضافة توكن البوت الخاص بك:
BOT_TOKEN=123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ
ثم أعد تشغيل البوت عبر: npm run dev
=====================================================
`);
    process.exit(1);
  }

  // التأكد من وجود مجلد الملفات المؤقتة
  await ensureDir(config.tempDir);

  const bot = createBot();

  // التحقق من الاتصال وعرض معلومات البوت
  console.log('🚀 جاري بدء تشغيل بوت التليجرام والاتصال بالخادم...');
  const botInfo = await bot.telegram.getMe();
  console.log(`
=====================================================
✅ البوت يعمل بنجاح الآن!
🤖 الاسم: ${botInfo.first_name} (@${botInfo.username})
🔗 الرابط: https://t.me/${botInfo.username}
جاهز لاستقبال الاستكرات وحزم التليجرام وتحويلها لواتساب.
=====================================================
`);

  await bot.launch({
    dropPendingUpdates: false
  });

  // إيقاف آمن عند الخروج
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('فشل بدء تشغيل البوت:', err);
});
