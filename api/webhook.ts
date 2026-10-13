import { createBot } from '../src/bot.js';
import { ensureDir } from '../src/utils/helpers.js';
import { config } from '../src/config.js';

export default async function handler(req: any, res: any) {
  // للتحقق من أن الرابط يعمل في المتصفح
  if (req.method === 'GET') {
    return res.status(200).send('🤖 Telegram to WhatsApp Sticker Bot is active and running on Vercel!');
  }

  if (req.method === 'POST') {
    try {
      await ensureDir(config.tempDir);
      const bot = createBot();
      
      // استقبال ومعالجة التحديث القادم من تليجرام
      await bot.handleUpdate(req.body);
      return res.status(200).json({ ok: true });
    } catch (error: any) {
      console.error('❌ خطأ في معالجة Webhook:', error);
      // نرجع 200 لتليجرام حتى لا يكرر إرسال الرسالة المتعطلة مراراً
      return res.status(200).json({ ok: false, error: error.message });
    }
  }

  return res.status(405).send('Method Not Allowed');
}
