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
        const totalPartsEstimate = Math.ceil(countToConvert / 30);
        const partsNote = totalPartsEstimate > 1
            ? `• <b>سيتم التقسيم إلى:</b> ${totalPartsEstimate} أجزاء (30 استكر لكل حزمة كحد أقصى لواتساب)\n`
            : '';
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `📦 <b>تم العثور على الحزمة:</b>\n` +
            `• <b>الاسم:</b> ${escapeHtml(stickerSet.title)}\n` +
            `• <b>إجمالي الاستكرات:</b> ${totalStickers}\n` +
            `• <b>سيتم تحويل:</b> ${countToConvert} استكر\n` +
            partsNote +
            `\n⏳ جاري التحميل والتحويل بمقاييس واتساب (0/${countToConvert})...`, { parse_mode: 'HTML' });
        const convertedPaths = new Array(countToConvert);
        let convertedCount = 0;
        let lastProgressUpdate = Date.now();
        const CONCURRENCY = 3;
        // دالة تحميل وتحويل الاستكر
        const processSticker = async (i) => {
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
                convertedPaths[i] = convPath;
            }
            catch (err) {
                console.warn(`تعذر تحويل الاستكر رقم ${i + 1}:`, err.message || err);
            }
            finally {
                convertedCount++;
                const now = Date.now();
                if (now - lastProgressUpdate > 2500 || convertedCount === countToConvert) {
                    lastProgressUpdate = now;
                    const pct = Math.round((convertedCount / countToConvert) * 10);
                    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `⏳ جاري التحميل والتحويل بمقاييس واتساب (${convertedCount}/${countToConvert})...\n` +
                        `[${'█'.repeat(pct)}${'░'.repeat(10 - pct)}]`).catch(() => { });
                }
            }
        };
        // تشغيل التحويل بالتوازي لزيادة السرعة
        let nextIndex = 0;
        const workers = Array.from({ length: Math.min(CONCURRENCY, countToConvert) }, async () => {
            while (nextIndex < countToConvert) {
                const currentIdx = nextIndex++;
                await processSticker(currentIdx);
            }
        });
        await Promise.all(workers);
        const validPaths = convertedPaths.filter(Boolean);
        if (validPaths.length === 0) {
            throw new Error('فشل تحويل أي استكر من الحزمة!');
        }
        // 3. تجهيز الحزم وتقسيمها إلى 30 استكر لكل ملف
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `🗜️ جاري تجميع الحزم وتقسيمها لمقاس واتساب (30 استكر لكل حزمة)...`).catch(() => { });
        const botInfo = await ctx.telegram.getMe();
        const botUsername = botInfo.username ? `@${botInfo.username}` : 'StickerBot';
        const packaged = await packageStickers({
            title: botUsername,
            author: botUsername,
            stickerPaths: validPaths,
            outputDir: sessionDir
        });
        // 4. إرسال أجزاء الحزم (.wastickers) مقسمة بحد أقصى 30 استكر لكل جزء
        for (const part of packaged.parts) {
            const partStats = await fs.stat(part.wastickersPath);
            const partInfoText = part.totalParts > 1
                ? ` (الجزء ${part.partNumber} من ${part.totalParts})`
                : '';
            await ctx.replyWithDocument({
                source: part.wastickersPath,
                filename: path.basename(part.wastickersPath)
            }, {
                caption: `🎉 <b>تم تجهيز حزمة واتساب${partInfoText}!</b>\n\n` +
                    `• <b>اسم الحزمة لواتساب:</b> ${escapeHtml(part.title)}\n` +
                    `• <b>الاستكرات في هذا الجزء:</b> ${part.count} استكر (حد واتساب 30)\n` +
                    `• <b>الحزمة الأصلية:</b> ${escapeHtml(stickerSet.title)}\n` +
                    `• <b>الحجم:</b> ${formatBytes(partStats.size)}\n\n` +
                    `📲 <b>طريقة الإضافة لواتساب:</b>\n` +
                    `1. اضغط على الملف أعلاه واختر <b>فتح بواسطة / Open With -> تطبيق Sticker Maker US</b>.\n` +
                    `2. اضغط على زر <b>إضافة إلى WhatsApp</b> وستضاف الحزمة فوراً بدون إعلانات!`,
                parse_mode: 'HTML'
            });
        }
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
