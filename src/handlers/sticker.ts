import { Context } from 'telegraf';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config.js';
import { ensureDir, removeDir, formatBytes } from '../utils/helpers.js';
import { getFileDownloadUrl, downloadFile } from '../services/telegram.js';
import { convertSticker, StickerType } from '../services/converter.js';
import { handlePackConversion } from './pack.js';

export async function handleSingleSticker(ctx: Context) {
  // @ts-ignore
  const sticker = ctx.message?.sticker;
  if (!sticker) return;

  const replyToMessageId = ctx.message?.message_id;

  // 1. إذا كان الاستكر ينتمي لحزمة استكرات، نقوم تلقائياً بجلب وتحويل الحزمة كاملة بالتوازي!
  if (sticker.set_name) {
    console.log(`📦 تم استقبال استكر ينتمي لحزمة: ${sticker.set_name}، جاري بدء المعالجة المتزامنة...`);
    await handlePackConversion(ctx, sticker.set_name, {
      replyToMessageId,
      stickerEmoji: sticker.emoji
    });
    return;
  }

  // 2. إذا كان الاستكر منفرداً ولا ينتمي لأي حزمة (معالجة غير معطلة Non-blocking)
  const statusMsg = await ctx.reply('⏳ جاري تحميل ومعالجة الاستكر بمقاييس واتساب (512×512)...', {
    reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    reply_to_message_id: replyToMessageId
  } as any);

  // تشغيل المعالجة في الخلفية لضمان عدم حجز حلقة الاستقبال لباقي المستخدمين
  setImmediate(async () => {
    const sessionId = `sticker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const sessionDir = path.join(config.tempDir, sessionId);

    try {
      await ensureDir(sessionDir);

      let type: StickerType = 'static';
      let inputExt = '.webp';

      if (sticker.is_video) {
        type = 'video';
        inputExt = '.webm';
      } else if (sticker.is_animated) {
        type = 'animated';
        inputExt = '.tgs';
      }

      const inputPath = path.join(sessionDir, `input${inputExt}`);
      const outputPath = path.join(sessionDir, `whatsapp_sticker.webp`);

      const downloadUrl = await getFileDownloadUrl(ctx.telegram as any, sticker.file_id);
      await downloadFile(downloadUrl, inputPath);
      await convertSticker(inputPath, outputPath, type);

      const stats = await fs.stat(outputPath);
      const sizeStr = formatBytes(stats.size);
      const typeLabel = type === 'static' ? 'ثابت' : type === 'video' ? 'فيديو متحرك' : 'متحرك TGS';

      await ctx.replyWithDocument(
        { source: outputPath, filename: `sticker_wa_${sticker.emoji || 'stk'}.webp` },
        {
          reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
          reply_to_message_id: replyToMessageId,
          caption: `✅ <b>تم تحويل الاستكر بنجاح!</b>\n\n` +
            `📌 <b>رداً على استكرك:</b> ${sticker.emoji || '🎨'}\n` +
            `• <b>النوع:</b> ${typeLabel}\n` +
            `• <b>المقاس:</b> 512×512 بكسل\n` +
            `• <b>الحجم:</b> ${sizeStr} (متوافق مع واتساب)\n\n` +
            `💡 يمكنك حفظ الملف واستخدامه مباشرة في واتساب.`,
          parse_mode: 'HTML'
        } as any
      );

      await ctx.telegram.deleteMessage(ctx.chat!.id, statusMsg.message_id).catch(() => {});

    } catch (error: any) {
      console.error('خطأ في معالجة الاستكر:', error);
      await ctx.telegram.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        undefined,
        `❌ عذراً، حدث خطأ أثناء معالجة الاستكر:\n${error.message || 'خطأ غير معروف'}`
      ).catch(() => {});
    } finally {
      await removeDir(sessionDir);
    }
  });
}
