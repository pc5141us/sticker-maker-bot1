import { ZipArchive } from 'archiver';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export interface PackageOptions {
  title: string;
  author: string;
  stickerPaths: string[]; // مسارات ملفات webp المحولة
  outputDir: string;
  traySourcePath?: string; // مسار الصورة المستخدمة كأيقونة (أو أول استكر افتراضياً)
}

export interface PackagedPart {
  wastickersPath: string;
  count: number;
  partNumber: number;
  totalParts: number;
  title: string;
}

export interface PackagedResult {
  parts: PackagedPart[];
  totalStickers: number;
}

/**
 * إنشاء أيقونة الحزمة tray.png بمقاس 96×96 وخلفية شفافة
 */
export async function createTrayIcon(sourcePath: string, outputPath: string): Promise<void> {
  await sharp(sourcePath)
    .resize(96, 96, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(outputPath);
}

/**
 * تجميع الاستكرات وتقسيمها تلقائياً إلى حزم بحد أقصى 30 استكر لكل حزمة (وفق متطلبات واتساب)
 */
export async function packageStickers(options: PackageOptions): Promise<PackagedResult> {
  const { title, author, stickerPaths, outputDir, traySourcePath } = options;
  const STICKERS_PER_PACK = 30;

  // تقسيم الاستكرات إلى مجموعات كل مجموعة بحد أقصى 30 استكر
  const chunks: string[][] = [];
  for (let i = 0; i < stickerPaths.length; i += STICKERS_PER_PACK) {
    chunks.push(stickerPaths.slice(i, i + STICKERS_PER_PACK));
  }

  const botTag = '@stickermakerusbot';
  const packBaseTitle = (title && title.startsWith('@')) ? title : botTag;
  const totalParts = chunks.length;
  const parts: PackagedPart[] = [];

  for (let idx = 0; idx < totalParts; idx++) {
    const chunk = chunks[idx];
    const partNumber = idx + 1;
    const partTitle = totalParts > 1 ? `${packBaseTitle} (P${partNumber})` : packBaseTitle;
    const fileNameSuffix = totalParts > 1 ? `_part${partNumber}` : '';
    const wastickersPath = path.join(outputDir, `stickermakerusbot${fileNameSuffix}.wastickers`);

    // 1. توليد أيقونة الغلاف tray.png من أول استكر في هذا الجزء
    const trayPath = path.join(outputDir, `tray_${partNumber}.png`);
    const iconSource = (idx === 0 && traySourcePath) ? traySourcePath : chunk[0];
    if (iconSource && fs.existsSync(iconSource)) {
      await createTrayIcon(iconSource, trayPath);
    }

    // 2. إنشاء أرشيف .wastickers لهذا الجزء
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(wastickersPath);
      const archive = new ZipArchive({ zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: any) => reject(err));
      archive.pipe(output);

      archive.append(partTitle, { name: 'title.txt' });
      archive.append(author, { name: 'author.txt' });

      if (fs.existsSync(trayPath)) {
        archive.file(trayPath, { name: 'tray.png' });
      }

      chunk.forEach((stkPath, sIdx) => {
        if (fs.existsSync(stkPath)) {
          const ext = path.extname(stkPath);
          const num = String(sIdx + 1).padStart(2, '0');
          archive.file(stkPath, { name: `${num}${ext}` });
        }
      });

      archive.finalize();
    });

    parts.push({
      wastickersPath,
      count: chunk.length,
      partNumber,
      totalParts,
      title: partTitle
    });
  }

  return {
    parts,
    totalStickers: stickerPaths.length
  };
}
