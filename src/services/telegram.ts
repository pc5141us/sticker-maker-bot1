import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export interface StickerInfo {
  fileId: string;
  fileUniqueId: string;
  emoji?: string;
  isAnimated: boolean;
  isVideo: boolean;
}

/**
 * الحصول على رابط تحميل الملف من تليجرام مع إعادة المحاولة التلقائية
 */
export async function getFileDownloadUrl(tg: any, fileId: string, retries = 2): Promise<string> {
  const telegram = tg?.telegram || tg;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fileLink = await telegram.getFileLink(fileId);
      return fileLink.toString();
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 600));
    }
  }
  throw new Error('فشل جلب رابط الملف من تليجرام');
}

/**
 * تحميل الملف وحفظه محلياً في المسار المحدد مع إعادة المحاولة التلقائية
 */
export async function downloadFile(url: string, destinationPath: string, retries = 2): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok || !response.body) {
        throw new Error(`فشل تحميل الملف: ${response.status} ${response.statusText}`);
      }

      const nodeStream = Readable.fromWeb(response.body as any);
      const fileWriteStream = fs.createWriteStream(destinationPath);
      await pipeline(nodeStream, fileWriteStream);
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 600));
    }
  }
}

/**
 * جلب تفاصيل حزمة استكرات تليجرام كاملة
 */
export async function getStickerSet(tg: any, name: string) {
  const telegram = tg?.telegram || tg;
  try {
    const stickerSet = await telegram.getStickerSet(name);
    return stickerSet;
  } catch (error: any) {
    throw new Error(`تعذر العثور على حزمة الاستكرات باسم: "${name}". تأكد من صحة الرابط أو الاسم.`);
  }
}
