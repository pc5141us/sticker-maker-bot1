import fs from 'fs/promises';
/**
 * تأكد من وجود المجلد، وإذا لم يكن موجوداً يتم إنشاؤه
 */
export async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}
/**
 * حذف مجلد ومحتوياته بأمان
 */
export async function removeDir(dirPath) {
    try {
        await fs.rm(dirPath, { recursive: true, force: true });
    }
    catch (err) {
        console.error(`خطأ أثناء حذف المجلد المؤقت ${dirPath}:`, err);
    }
}
/**
 * تنظيف اسم الملف لإزالة الرموز غير الصالحة
 */
export function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_').substring(0, 50);
}
/**
 * تنسيق حجم الملف للعرض البشري (KB / MB)
 */
export function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
/**
 * تأخير زمني بالمللي ثانية
 */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * استخراج اسم الحزمة من رابط تليجرام أو الاسم المباشر
 * أمثلة:
 * - https://t.me/addstickers/Animals
 * - t.me/addstickers/Animals
 * - tg://addstickers?set=Animals
 * - Animals
 */
export function extractPackName(input) {
    const trimmed = input.trim();
    const linkRegex = /(?:t\.me\/addstickers\/|tg:\/\/addstickers\?set=)([a-zA-Z0-9_]+)/i;
    const match = trimmed.match(linkRegex);
    if (match && match[1]) {
        return match[1];
    }
    // إذا كان اسم الحزمة فقط بدون رابط ومكون من أحرف صالحة
    if (/^[a-zA-Z0-9_]{3,64}$/.test(trimmed)) {
        return trimmed;
    }
    return null;
}
/**
 * الهروب من الرموز الخاصة في HTML لتليجرام
 */
export function escapeHtml(text) {
    if (!text)
        return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
