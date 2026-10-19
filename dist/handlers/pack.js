import { Markup } from 'telegraf';
import path from 'path';
import { config } from '../config.js';
import { ensureDir, removeDir, extractPackName, formatBytes, escapeHtml } from '../utils/helpers.js';
import { getFileDownloadUrl, downloadFile, getStickerSet } from '../services/telegram.js';
import { convertSticker, convertStaticSticker } from '../services/converter.js';
import { tgsEngine } from '../services/tgs-engine.js';
import { packageStickers } from '../services/packager.js';
import { taskManager } from '../services/task-manager.js';
import fs from 'fs/promises';
export async function handlePackConversion(ctx, input, options) {
    const packName = extractPackName(input);
    const replyParams = options?.replyToMessageId ? { message_id: options.replyToMessageId } : undefined;
    if (!packName) {
        await ctx.reply('❌ الرابط أو الاسم غير صالح. يرجى إرسال رابط حزمة صالح مثل:\n' +
            '<code>https://t.me/addstickers/Animals</code>\nأو اسم الحزمة مباشرة.', {
            parse_mode: 'HTML',
            reply_parameters: replyParams,
            reply_to_message_id: options?.replyToMessageId
        });
        return;
    }
    // إرسال رسالة الحالة فوراً في أجزاء من الثانية دون تعطيل البوت
    const statusMsg = await ctx.reply(`🔍 جاري فحص الحزمة: <code>${escapeHtml(packName)}</code>...`, {
        parse_mode: 'HTML',
        reply_parameters: replyParams,
        reply_to_message_id: options?.replyToMessageId
    });
    const taskId = `pack_${packName}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const userId = ctx.from?.id || 0;
    const userName = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'مستخدم');
    // تشغيل مهمة التحويل في نظام المهام المتزامنة بالتوازي
    await taskManager.enqueue(taskId, userId, userName, packName, async () => {
        const sessionId = `pack_${packName}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
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
            const stickerEmojiText = options?.stickerEmoji ? `${options.stickerEmoji} ` : '';
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `📦 <b>تم العثور على الحزمة:</b>\n` +
                `• <b>الاستكر المستلم:</b> ${stickerEmojiText}<code>${escapeHtml(stickerSet.title)}</code>\n` +
                `• <b>إجمالي الاستكرات:</b> ${totalStickers}\n` +
                `• <b>سيتم تحويل:</b> ${countToConvert} استكر\n` +
                partsNote +
                `\n⚡ جاري التحميل والتحويل فائق السرعة بمقاييس واتساب (0/${countToConvert})...`, { parse_mode: 'HTML' });
            const convertedPaths = new Array(countToConvert);
            let convertedCount = 0;
            let lastProgressUpdate = Date.now();
            // ضبط التوازي الداخلي للحزمة لسرعة قصوى
            const isAnimatedPack = stickerSet.stickers.some((s) => s.is_animated);
            const isVideoPack = stickerSet.stickers.some((s) => s.is_video);
            const CONCURRENCY = (isAnimatedPack && tgsEngine.isAvailable()) ? 4 : isVideoPack ? 4 : 12;
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
                const thumb = stk.thumbnail || stk.thumb;
                // إذا كان استكر متحرك TGS ومحرك Chrome غير متاح على السيرفر (مثل Vercel)، نستخدم مباشرة المعاينة المعتمدة لتوفير الوقت وضمان النجاح 100%
                if (type === 'animated' && !tgsEngine.isAvailable() && thumb?.file_id) {
                    try {
                        const thumbUrl = await getFileDownloadUrl(ctx.telegram, thumb.file_id);
                        const thumbRaw = path.join(stickersDir, `thumb_${i}.webp`);
                        await downloadFile(thumbUrl, thumbRaw);
                        await convertStaticSticker(thumbRaw, convPath);
                        convertedPaths[i] = convPath;
                        return;
                    }
                    catch (thumbErr) {
                        console.warn(`تعذر استخدام المعاينة المباشرة للاستكر رقم ${i + 1}:`, thumbErr.message);
                    }
                }
                try {
                    const downloadUrl = await getFileDownloadUrl(ctx.telegram, stk.file_id);
                    await downloadFile(downloadUrl, rawPath);
                    await convertSticker(rawPath, convPath, type);
                    convertedPaths[i] = convPath;
                }
                catch (err) {
                    console.warn(`تعذر تحويل الاستكر رقم ${i + 1} (${err.message}). جاري محاولة استخدام الصورة البديلة...`);
                    if (thumb?.file_id && !convertedPaths[i]) {
                        try {
                            const thumbUrl = await getFileDownloadUrl(ctx.telegram, thumb.file_id);
                            const thumbRaw = path.join(stickersDir, `thumb_fallback_${i}.webp`);
                            await downloadFile(thumbUrl, thumbRaw);
                            await convertStaticSticker(thumbRaw, convPath);
                            convertedPaths[i] = convPath;
                        }
                        catch (_) { }
                    }
                }
                finally {
                    convertedCount++;
                    taskManager.updateTaskProgress(taskId, `${convertedCount}/${countToConvert}`);
                    const now = Date.now();
                    if (now - lastProgressUpdate > 2500 || convertedCount === countToConvert) {
                        lastProgressUpdate = now;
                        const pct = Math.round((convertedCount / countToConvert) * 10);
                        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `⏳ جاري التحميل والتحويل السريع (${convertedCount}/${countToConvert})...\n` +
                            `[${'█'.repeat(pct)}${'░'.repeat(10 - pct)}]`).catch(() => { });
                    }
                }
            };
            // تشغيل عمال التحويل المتوازيين
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
            // 3. تجهيز الحزم وتقسيمها إلى 30 استكر لكل ملف بالتوازي
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `🗜️ جاري تجميع الحزم وتقسيمها لمقاس واتساب (30 استكر لكل حزمة)...`).catch(() => { });
            const botInfo = await ctx.telegram.getMe();
            const botUsername = botInfo.username ? `@${botInfo.username}` : '@stickermakerusbot';
            const packaged = await packageStickers({
                title: botUsername,
                author: botUsername,
                stickerPaths: validPaths,
                outputDir: sessionDir
            });
            // 4. إرسال أجزاء الحزم (.wastickers) مع الرد على الاستكر الأصلي
            for (const part of packaged.parts) {
                const partStats = await fs.stat(part.wastickersPath);
                const partInfoText = part.totalParts > 1
                    ? ` (الجزء ${part.partNumber} من ${part.totalParts})`
                    : '';
                const stickerMentionHeader = options?.replyToMessageId
                    ? `📌 <b>رداً على الاستكر المرسل:</b> ${stickerEmojiText}<code>${escapeHtml(stickerSet.title)}</code>\n`
                    : `📦 <b>الحزمة الأصلية:</b> ${stickerEmojiText}<code>${escapeHtml(stickerSet.title)}</code>\n`;
                await ctx.replyWithDocument({
                    source: part.wastickersPath,
                    filename: path.basename(part.wastickersPath)
                }, {
                    reply_parameters: replyParams,
                    reply_to_message_id: options?.replyToMessageId,
                    caption: `🎉 <b>تم تجهيز حزمة واتساب${partInfoText}!</b>\n\n` +
                        stickerMentionHeader +
                        `• <b>اسم الحزمة لواتساب:</b> ${escapeHtml(part.title)}\n` +
                        `• <b>الاستكرات في هذا الجزء:</b> ${part.count} استكر (حد واتساب 30)\n` +
                        `• <b>الحجم:</b> ${formatBytes(partStats.size)}\n\n` +
                        `📲 <b>طريقة الإضافة لواتساب:</b>\n` +
                        `1. اضغط على الملف واختر <b>فتح بواسطة / Open With -> Sticker Maker US</b> (أو افتح التطبيق واضغط على <b>استيراد حزمة</b>).\n` +
                        `2. اضغط على <b>إضافة إلى WhatsApp</b> أو <b>WhatsApp Business</b> للإضافة فوراً!`,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('📲 تحميل تطبيق Sticker Maker US (APK)', 'download_app')]
                    ])
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
            await removeDir(sessionDir);
        }
    }, async (queuePosition) => {
        // إشعار المستخدم فوراً بموقعه في طابور الانتظار
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `⏳ <b>طلبك في قائمة الانتظار (ترتيبك #${queuePosition})...</b>\n` +
            `البوت يعالج حالياً عدة حزم أخرى بالتوازي، وسيبدأ تحويل حزمتك تلقائياً بعد قليل!`, { parse_mode: 'HTML' }).catch(() => { });
    });
}
