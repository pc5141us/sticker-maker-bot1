import dotenv from 'dotenv';
import path from 'path';
dotenv.config();
export const config = {
    botToken: process.env.BOT_TOKEN || '',
    tempDir: process.env.VERCEL ? '/tmp/tg-temp' : path.resolve(process.cwd(), process.env.TEMP_DIR || 'temp'),
    maxPackStickers: parseInt(process.env.MAX_PACK_STICKERS || '300', 10),
    maxStaticSizeKb: parseInt(process.env.MAX_STATIC_SIZE_KB || '100', 10),
    maxAnimatedSizeKb: parseInt(process.env.MAX_ANIMATED_SIZE_KB || '500', 10),
};
if (!config.botToken) {
    console.warn('⚠️ تحذير: BOT_TOKEN غير محدد في ملف .env! يرجى إضافته لتشغيل البوت.');
}
