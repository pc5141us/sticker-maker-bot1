import dotenv from 'dotenv';
import path from 'path';
import { decryptToken, maskToken } from './services/security.js';
dotenv.config();
function resolveBotToken() {
    // 1. فك تشفير التوكن في الذاكرة فقط إذا كان مشفراً
    if (process.env.ENCRYPTED_BOT_TOKEN) {
        try {
            const decrypted = decryptToken(process.env.ENCRYPTED_BOT_TOKEN, process.env.BOT_MASTER_KEY);
            return decrypted;
        }
        catch (e) {
            console.error('❌ فشل فك تشفير ENCRYPTED_BOT_TOKEN:', e.message);
        }
    }
    // 2. التراجع للتوكن الصريح إذا وجد
    if (process.env.BOT_TOKEN) {
        return process.env.BOT_TOKEN;
    }
    // 3. التراجع للتوكن الافتراضي للبوت
    return '8694545980:AAFTcq3XJYLWbSTQpZM1vNOFZBL9sBsdi4A';
}
export const config = {
    botToken: resolveBotToken(),
    adminId: parseInt(process.env.ADMIN_ID || '682572594', 10),
    tempDir: process.env.VERCEL ? '/tmp/tg-temp' : path.resolve(process.cwd(), process.env.TEMP_DIR || 'temp'),
    maxPackStickers: parseInt(process.env.MAX_PACK_STICKERS || '300', 10),
    maxStaticSizeKb: parseInt(process.env.MAX_STATIC_SIZE_KB || '100', 10),
    maxAnimatedSizeKb: parseInt(process.env.MAX_ANIMATED_SIZE_KB || '500', 10),
};
if (!config.botToken) {
    console.warn('⚠️ تحذير: لم يتم العثور على توكن البوت في ملف .env!');
}
else if (process.env.ENCRYPTED_BOT_TOKEN) {
    console.log(`🔒 تم تحميل التوكن المشفر بنجاح (${maskToken(config.botToken)})`);
}
console.log(`👑 معرف الأدمن المعتمد: ${config.adminId}`);
