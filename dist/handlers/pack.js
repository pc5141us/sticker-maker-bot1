import path from 'path';
import { config } from '../config.js';
import { ensureDir, removeDir, extractPackName, formatBytes, escapeHtml } from '../utils/helpers.js';
import { getFileDownloadUrl, downloadFile, getStickerSet } from '../services/telegram.js';
import { convertSticker } from '../services/converter.js';
import { packageStickers } from '../services/packager.js';
import fs from 'fs/promises';
export async function handlePackConversion(ctx, input) {
    const packName = extractPackName(input);
    if (!packName) {
        await ctx.reply('❌ الرابط أو الاسم غير صالح. يرجى إرسال رابط حزمة صالح مثل:\n' +
            '<code>https://t.me/addstickers/Animals</code>\nأو اسم الحزمة مباشرة.', { parse_mode: 'HTML' });
        return;
    }
    const statusMsg = await ctx.reply(`🔍 جاري فحص الحزمة: <code>${escapeHtml(packName)}</code>...`, { parse_mode: 'HTML' });
    const sessionId = `pack_${packName}_${Date.now()}`;
    const sessionDir = path.join(config.tempDir, sessionId);
    const stickersDir = path.join(sessionDir, 'stickers');
    const convertedDir = path.join(sessionDir, 'converted');
    try {
        await ensureDir(stickersDir);
        await ensureDir(convertedDir);
        // 1. جلب بيانات الحزمة من تليجرام
        const stickerSet = await getStickerSet(ctx.telegram, packName);
        const totalStickers = stickerSet.stickers.length;
        if (totalStickers === 0) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, '⚠️ هذه الحزمة فارغة ولا تحتوي على أي استكرات!');
            return;
        }
        const countToConvert = Math.min(totalStickers, config.maxPackStickers);
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `📦 <b>تم العثور على الحزمة:</b>\n` +
            `• <b>الاسم:</b> ${escapeHtml(stickerSet.title)}\n` +
            `• <b>إجمالي الاستكرات:</b> ${totalStickers}\n` +
            `• <b>سيتم تحويل:</b> ${countToConvert} استكر\n\n` +
            `⏳ جاري التحميل والتحويل بمقاييس واتساب (0/${countToConvert})...`, { parse_mode: 'HTML' });
        const convertedPaths = [];
        let lastProgressUpdate = Date.now();
        // 2. تحميل وتحويل الاستكرات
        for (let i = 0; i < countToConvert; i++) {
            const stk = stickerSet.stickers[i];
            let type = 'static';
            let ext = '.webp';
            if (stk.is_video) {
                type = 'video';
                ext = '.webm';
            }
            else if (stk.is_animated) {
                type = 'animated';
                ext = '.tgs';
            }
            const rawPath = path.join(stickersDir, `stk_${i}${ext}`);
            const convPath = path.join(convertedDir, `stk_${i + 1}.webp`);
            try {
                const downloadUrl = await getFileDownloadUrl(ctx.telegram, stk.file_id);
                await downloadFile(downloadUrl, rawPath);
                await convertSticker(rawPath, convPath, type);
                convertedPaths.push(convPath);
            }
            catch (err) {
                console.warn(`تعذر تحويل الاستكر رقم ${i + 1}:`, err.message || err);
            }
            // تحديث رسالة التقدم كل ثانيتين أو عند آخر استكر
            const now = Date.now();
            if (now - lastProgressUpdate > 2500 || i === countToConvert - 1) {
                lastProgressUpdate = now;
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `⏳ جاري التحميل والتحويل بمقاييس واتساب (${i + 1}/${countToConvert})...\n` +
                    `[${'█'.repeat(Math.round(((i + 1) / countToConvert) * 10))}${'░'.repeat(10 - Math.round(((i + 1) / countToConvert) * 10))}]`).catch(() => { });
            }
        }
        if (convertedPaths.length === 0) {
            throw new Error('فشل تحويل أي استكر من الحزمة!');
        }
        // 3. تجهيز الحزمة بصيغة .wastickers و .zip
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `🗜️ جاري تجميع الحزمة في ملف .wastickers لتطبيق Sticker Maker...`).catch(() => { });
        const botInfo = await ctx.telegram.getMe();
        const botUsername = botInfo.username ? `@${botInfo.username}` : 'StickerBot';
        const packaged = await packageStickers({
            title: botUsername,
            author: botUsername,
            stickerPaths: convertedPaths,
            outputDir: sessionDir
        });
        const wastickersStats = await fs.stat(packaged.wastickersPath);
        const zipStats = await fs.stat(packaged.zipPath);
        // 4. إرسال ملف .wastickers لتطبيقات الاستكرات (مثل Sticker Maker)
        await ctx.replyWithDocument({
            source: packaged.wastickersPath,
            filename: path.basename(packaged.wastickersPath)
        }, {
            caption: `🎉 <b>تم تجهيز حزمة واتساب بنجاح!</b>\n\n` +
                `• <b>اسم الحزمة لواتساب:</b> ${escapeHtml(botUsername)}\n` +
                `• <b>الحزمة الأصلية:</b> ${escapeHtml(stickerSet.title)}\n` +
                `• <b>الاستكرات المحولة:</b> ${packaged.count}\n` +
                `• <b>الحجم:</b> ${formatBytes(wastickersStats.size)}\n\n` +
                `📲 <b>طريقة الاستخدام على الهاتف:</b>\n` +
                `1. اضغط على الملف أعلاه واختر <b>"فتح بواسطة / Open With"</b>.\n` +
                `2. اختر تطبيق <b>Sticker Maker</b>.\n` +
                `3. اضغط على <b>"Add to WhatsApp"</b> وستضاف الحزمة لواتساب باسم: <b>${escapeHtml(botUsername)}</b>!`,
            parse_mode: 'HTML'
        });
        // 5. إرسال ملف .zip لخيارات الاستخدام البديلة
        await ctx.replyWithDocument({
            source: packaged.zipPath,
            filename: path.basename(packaged.zipPath)
        }, {
            caption: `📁 <b>نسخة أرشيف ZIP للملفات:</b>\n` +
                `يحتوي على كافة ملفات WebP (512×512) للاستخدام على الكمبيوتر أو الاستخراج اليدوي (${formatBytes(zipStats.size)}).`,
            parse_mode: 'HTML'
        });
        // مسح رسالة التحميل المؤقتة
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => { });
    }
    catch (error) {
        console.error('خطأ أثناء تحويل الحزمة:', error);
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ حدث خطأ أثناء تحويل الحزمة:\n${error.message || 'خطأ غير معروف'}`).catch(() => { });
    }
    finally {
        // تنظيف المجلد المؤقت بعد الإرسال
        await removeDir(sessionDir);
    }
}
