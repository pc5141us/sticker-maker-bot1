import { config } from '../src/config.js';

async function manageWebhook() {
  const token = config.botToken;
  if (!token) {
    console.error('❌ لم يتم العثور على BOT_TOKEN في ملف .env!');
    process.exit(1);
  }

  const arg = process.argv[2];

  if (!arg || arg === '--help') {
    console.log(`
ℹ️ **طريقة الاستخدام:**
1. لتعيين Webhook الخاص بـ Vercel:
   npm run set-webhook https://your-project.vercel.app

2. لإلغاء الـ Webhook (والعودة للتشغيل المحلي):
   npm run set-webhook --delete
`);
    return;
  }

  if (arg === '--delete') {
    console.log('🔄 جاري حذف Webhook والعودة لوضع Long Polling...');
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
    const data = await res.json();
    console.log('نتيجة تليجرام:', data);
    return;
  }

  // تنظيف الرابط
  let baseUrl = arg.trim().replace(/\/$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = `https://${baseUrl}`;
  }

  const webhookUrl = `${baseUrl}/api/webhook`;
  console.log(`🔗 جاري ربط تليجرام مع Vercel على الرابط: ${webhookUrl}`);

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}&drop_pending_updates=true`);
  const data: any = await res.json();

  if (data.ok) {
    console.log(`
=====================================================
🎉 تم ربط الـ Webhook بنجاح!
🤖 البوت الآن يستقبل الرسائل مباشرة عبر سيرفر Vercel.
🔗 رابط الـ Webhook: ${webhookUrl}
=====================================================
`);
  } else {
    console.error('❌ فشل تعيين الـ Webhook:', data);
  }
}

manageWebhook().catch(console.error);
