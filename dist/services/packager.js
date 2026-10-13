import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
/**
 * إنشاء أيقونة الحزمة tray.png بمقاس 96×96 وخلفية شفافة
 */
export async function createTrayIcon(sourcePath, outputPath) {
    await sharp(sourcePath)
        .resize(96, 96, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
        .png()
        .toFile(outputPath);
}
/**
 * تجميع الاستكرات في حزمة .wastickers وحزمة .zip متوافقة مع تطبيقات استكرات واتساب
 */
export async function packageStickers(options) {
    const { title, author, stickerPaths, outputDir, traySourcePath } = options;
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g, '_').substring(0, 30) || 'Stickers';
    const wastickersPath = path.join(outputDir, `${sanitizedTitle}.wastickers`);
    const zipPath = path.join(outputDir, `${sanitizedTitle}.zip`);
    // 1. إنشاء أيقونة الحزمة
    const trayPath = path.join(outputDir, 'tray.png');
    const iconSource = traySourcePath || stickerPaths[0];
    if (iconSource && fs.existsSync(iconSource)) {
        await createTrayIcon(iconSource, trayPath);
    }
    // دالة مساعدة لإنشاء ملف الأرشيف
    const createArchive = (targetPath) => {
        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(targetPath);
            const archive = new ZipArchive({ zlib: { level: 9 } });
            output.on('close', () => resolve());
            archive.on('error', (err) => reject(err));
            archive.pipe(output);
            // ملفات بيانات الحزمة المطلوبة لتطبيقات Sticker Maker
            archive.append(title, { name: 'title.txt' });
            archive.append(author, { name: 'author.txt' });
            // إضافة أيقونة الحزمة إن وُجدت
            if (fs.existsSync(trayPath)) {
                archive.file(trayPath, { name: 'tray.png' });
            }
            // إضافة الاستكرات مرقمة
            stickerPaths.forEach((stkPath, index) => {
                if (fs.existsSync(stkPath)) {
                    const ext = path.extname(stkPath);
                    const num = String(index + 1).padStart(2, '0');
                    archive.file(stkPath, { name: `${num}${ext}` });
                }
            });
            archive.finalize();
        });
    };
    // إنشاء كلا الملفين (.wastickers و .zip) لراحة المستخدم
    await createArchive(wastickersPath);
    await createArchive(zipPath);
    return {
        wastickersPath,
        zipPath,
        count: stickerPaths.length
    };
}
