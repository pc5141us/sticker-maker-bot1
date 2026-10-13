import { Context, Telegraf } from 'telegraf';
import path from 'path';
import { config } from '../config.js';
import { ensureDir, removeDir, extractPackName, formatBytes } from '../utils/helpers.js';
import { getFileDownloadUrl, downloadFile, getStickerSet } from '../services/telegram.js';
import { convertSticker, StickerType } from '../services/converter.js';
import { packageStickers } from '../services/packager.js';
import fs from 'fs/promises';

export async function handlePackConversion(ctx: Context, input: string) {
  const packName = extractPackName(input);
  if (!packName) {
    await ctx.reply(
      '❌ الرابط أو الاسم غير صالح. يرجى إرسال رابط حزمة صالح مثل:\n' +
      '`https://t.me/addstickers/Animals`\nأو اسم الحزمة مباشرة.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const statusMsg = await ctx.reply(`🔍 جاري فحص الحزمة: \`${packName}\`...`, { parse_mode: 'Markdown' });

  const sessionId = `pack_${packName}_${Date.now()}`;
  const sessionDir = path.join(config.tempDir, sessionId);
  const stickersDir = path.join(sessionDir, 'stickers');
  const convertedDir = path.join(sessionDir, 'converted');

  try {
    await ensureDir(stickersDir);
    await ensureDir(convertedDir);

    // 1. جلب بيانات الحزمة من تليجرام
    const stickerSet = await getStickerSet(ctx.telegram as any, packName);
    const totalStickers = stickerSet.stickers.length;

    if (totalStickers === 0) {
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        '⚠️ هذه الحزمة فارغة ولا تحتوي على أي استكرات!'
      );
      return;
    }

    const countToConvert = Math.min(totalStickers, config.maxPackStickers);

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `📦 **تم العثور على الحزمة:**\n` +
      `• **الاسم:** ${stickerSet.title}\n` +
      `• **إجمالي الاستكرات:** ${totalStickers}\n` +
      `• **سيتم تحويل:** ${countToConvert} استكر\n\n` +
      `⏳ جاري التحميل والتحويل بمقاييس واتساب (0/${countToConvert})...`,
      { parse_mode: 'Markdown' }
    );

    const convertedPaths: string[] = [];
    let lastProgressUpdate = Date.now();

    // 2. تحميل وتحويل الاستكرات
    for (let i = 0; i < countToConvert; i++) {
      const stk = stickerSet.stickers[i];

      let type: StickerType = 'static';
      let ext = '.webp';
      if (stk.is_video) {
        type = 'video';
        ext = '.webm';
      } else if (stk.is_animated) {
        type = 'animated';
        ext = '.tgs';
      }

      const rawPath = path.join(stickersDir, `stk_${i}${ext}`);
      const convPath = path.join(convertedDir, `stk_${i + 1}.webp`);

      try {
        const downloadUrl = await getFileDownloadUrl(ctx.telegram as any, stk.file_id);
        await downloadFile(downloadUrl, rawPath);
        await convertSticker(rawPath, convPath, type);
        convertedPaths.push(convPath);
      } catch (err) {
        console.warn(`تعذر تحويل الاستكر رقم ${i + 1}:`, err);
      }

      // تحديث رسالة التقدم كل ثانيتين أو كل 5 استكرات
      const now = Date.now();
      if (now - lastProgressUpdate > 2500 || i === countToConvert - 1) {
        lastProgressUpdate = now;
        await ctx.telegram.editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `⏳ جاري التحميل والتحويل بمقاييس واتساب (${i + 1}/${countToConvert})...\n` +
          `[${'█'.repeat(Math.round(((i + 1) / countToConvert) * 10))}${'░'.repeat(10 - Math.round(((i + 1) / countToConvert) * 10))}]`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
    }

    if (convertedPaths.length === 0) {
      throw new Error('فشل تحويل أي استكر من الحزمة!');
    }

    // 3. تجهيز الحزمة بصيغة .wastickers و .zip
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `🗜️ جاري تجميع الحزمة في ملف .wastickers لتطبيق Sticker Maker...`
    ).catch(() => {});

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
    await ctx.replyWithDocument(
      {
        source: packaged.wastickersPath,
        filename: path.basename(packaged.wastickersPath)
      },
      {
        caption: `🎉 **تم تجهيز حزمة واتساب بنجاح!**\n\n` +
          `• **اسم الحزمة لواتساب:** ${botUsername}\n` +
          `• **الحزمة الأصلية:** ${stickerSet.title}\n` +
          `• **الاستكرات المحولة:** ${packaged.count}\n` +
          `• **الحجم:** ${formatBytes(wastickersStats.size)}\n\n` +
          `📲 **طريقة الاستخدام على الهاتف:**\n` +
          `1. اضغط على الملف أعلاه واختر **"فتح بواسطة / Open With"**.\n` +
          `2. اختر تطبيق **Sticker Maker**.\n` +
          `3. اضغط على **"Add to WhatsApp"** وستضاف الحزمة لواتساب باسم: **${botUsername}**!`,
        parse_mode: 'Markdown'
      }
    );

    // 5. إرسال ملف .zip لخيارات الاستخدام البديلة
    await ctx.replyWithDocument(
      {
        source: packaged.zipPath,
        filename: path.basename(packaged.zipPath)
      },
      {
        caption: `📁 **نسخة أرشيف ZIP للملفات:**\n` +
          `يحتوي على كافة ملفات WebP (512×512) للاستخدام على الكمبيوتر أو الاستخراج اليدوي (${formatBytes(zipStats.size)}).`,
        parse_mode: 'Markdown'
      }
    );

    // مسح رسالة التحميل المؤقتة
    await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

  } catch (error: any) {
    console.error('خطأ أثناء تحويل الحزمة:', error);
    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `❌ حدث خطأ أثناء تحويل الحزمة:\n${error.message || 'خطأ غير معروف'}`
    ).catch(() => {});
  } finally {
    // تنظيف المجلد المؤقت بعد الإرسال
    await removeDir(sessionDir);
  }
}
