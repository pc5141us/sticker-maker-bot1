import { Context } from 'telegraf';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config.js';
import { ensureDir, removeDir, formatBytes } from '../utils/helpers.js';
import { getFileDownloadUrl, downloadFile } from '../services/telegram.js';
import { convertSticker, StickerType } from '../services/converter.js';

export async function handleSingleSticker(ctx: Context) {
  // @ts-ignore
  const sticker = ctx.message?.sticker;
  if (!sticker) return;

  const statusMsg = await ctx.reply('⏳ جاري تحميل ومعالجة الاستكر بمقاييس واتساب (512×512)...');

  const sessionId = `sticker_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const sessionDir = path.join(config.tempDir, sessionId);

  try {
    await ensureDir(sessionDir);

    // تحديد نوع الاستكر
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

    // 1. الحصول على رابط الملف وتحميله
    const downloadUrl = await getFileDownloadUrl(ctx.telegram as any, sticker.file_id);
    await downloadFile(downloadUrl, inputPath);

    // 2. التحويل إلى صيغة ومقاييس واتساب
    await convertSticker(inputPath, outputPath, type);

    const stats = await fs.stat(outputPath);
    const sizeStr = formatBytes(stats.size);

    // 3. إرسال الملف الناتج للمستخدم
    const typeLabel = type === 'static' ? 'ثابت' : type === 'video' ? 'فيديو متحرك' : 'متحرك TGS';

    await ctx.replyWithDocument(
      { source: outputPath, filename: `sticker_wa_${sticker.emoji || 'stk'}.webp` },
      {
        caption: `✅ **تم تحويل الاستكر بنجاح!**\n\n` +
          `• **النوع:** ${typeLabel}\n` +
          `• **المقاس:** 512×512 بكسل\n` +
          `• **الحجم:** ${sizeStr} (متوافق مع واتساب)\n\n` +
          `💡 يمكنك حفظ الملف واستخدامه مباشرة في واتساب.\n` +
          `📦 لتحويل الحزمة كاملة، أرسل رابط الحزمة: \`t.me/addstickers/...\``,
        parse_mode: 'Markdown'
      }
    );

    // حذف رسالة الحالة لتنظيف الشات
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
    // تنظيف المجلد المؤقت
    await removeDir(sessionDir);
  }
}
