import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
/**
 * الحصول على رابط تحميل الملف من تليجرام
 */
export async function getFileDownloadUrl(tg, fileId) {
    const telegram = tg?.telegram || tg;
    const fileLink = await telegram.getFileLink(fileId);
    return fileLink.toString();
}
/**
 * تحميل الملف وحفظه محلياً في المسار المحدد
 */
export async function downloadFile(url, destinationPath) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`فشل تحميل الملف: ${response.status} ${response.statusText}`);
    }
    // تحويل web stream إلى Node.js readable stream
    const nodeStream = Readable.fromWeb(response.body);
    const fileWriteStream = fs.createWriteStream(destinationPath);
    await pipeline(nodeStream, fileWriteStream);
}
/**
 * جلب تفاصيل حزمة استكرات تليجرام كاملة
 */
export async function getStickerSet(tg, name) {
    const telegram = tg?.telegram || tg;
    try {
        const stickerSet = await telegram.getStickerSet(name);
        return stickerSet;
    }
    catch (error) {
        throw new Error(`تعذر العثور على حزمة الاستكرات باسم: "${name}". تأكد من صحة الرابط أو الاسم.`);
    }
}
