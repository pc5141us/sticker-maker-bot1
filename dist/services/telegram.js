import fs from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
/**
 * الحصول على رابط تحميل الملف من تليجرام مع إعادة المحاولة التلقائية
 */
export async function getFileDownloadUrl(tg, fileId, retries = 2) {
    const telegram = tg?.telegram || tg;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const fileLink = await telegram.getFileLink(fileId);
            return fileLink.toString();
        }
        catch (err) {
            if (attempt === retries)
                throw err;
            await new Promise(r => setTimeout(r, 600));
        }
    }
    throw new Error('فشل جلب رابط الملف من تليجرام');
}
/**
 * تحميل الملف وحفظه محلياً في المسار المحدد مع إعادة المحاولة التلقائية
 */
export async function downloadFile(url, destinationPath, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url);
            if (!response.ok || !response.body) {
                throw new Error(`فشل تحميل الملف: ${response.status} ${response.statusText}`);
            }
            const nodeStream = Readable.fromWeb(response.body);
            const fileWriteStream = fs.createWriteStream(destinationPath);
            await pipeline(nodeStream, fileWriteStream);
            return;
        }
        catch (err) {
            if (attempt === retries)
                throw err;
            await new Promise(r => setTimeout(r, 600));
        }
    }
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
