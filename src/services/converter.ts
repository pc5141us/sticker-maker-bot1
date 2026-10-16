import fs from 'fs/promises';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import { tgsEngine } from './tgs-engine.js';

// ضبط مسار ffmpeg تلقائياً
const ffmpegPath = (ffmpegInstaller as any)?.default || ffmpegInstaller;
if (typeof ffmpegPath === 'string') {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export type StickerType = 'static' | 'video' | 'animated';

/**
 * تحويل الاستكر الثابت (WebP / PNG) إلى معايير واتساب بسرعة فائقة:
 * - الأبعاد: 512×512 بكسل (مع حواف شفافة للحفاظ على النسبة الأصلية)
 * - الحجم: أقل من 100 كيلوبايت
 * - الصيغة: WebP
 */
export async function convertStaticSticker(inputPath: string, outputPath: string): Promise<string> {
  // التحقق أولاً إذا كان الملف جاهزاً ومطابقاً للشروط لتوفير وقت المعالجة
  try {
    const stats = await fs.stat(inputPath);
    if (stats.size <= 96 * 1024 && inputPath.endsWith('.webp')) {
      const meta = await sharp(inputPath).metadata();
      if (meta.width === 512 && meta.height === 512 && meta.format === 'webp') {
        await fs.copyFile(inputPath, outputPath);
        return outputPath;
      }
    }
  } catch (_) {}

  // تحويل فائق السرعة باستخدام effort: 1 لسرعة قصوى
  let buffer = await sharp(inputPath)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality: 80, effort: 1 })
    .toBuffer();

  if (buffer.length > 98 * 1024) {
    buffer = await sharp(inputPath)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 60, effort: 1 })
      .toBuffer();
  }

  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

/**
 * تحويل استكر الفيديو (WebM VP9) إلى استكر متحرك لواتساب بسرعة فائقة:
 * - الأبعاد: 512×512 بكسل
 * - المدة: 3 ثواني كحد أقصى
 * - معدل الإطارات: 14 إطار في الثانية
 * - التكرار: لا نهائي (loop 0)
 * - الحجم: أقل من 500 كيلوبايت
 */
export async function convertVideoSticker(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setDuration(3)
      .outputOptions([
        '-vf fps=14,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
        '-vcodec libwebp',
        '-lossless 0',
        '-compression_level 1',
        '-q:v 40',
        '-loop 0',
        '-an',
        '-threads 0'
      ])
      .save(outputPath)
      .on('end', async () => {
        try {
          const stats = await fs.stat(outputPath);
          if (stats.size > 480 * 1024) {
            const compressedPath = outputPath.replace('.webp', '_comp.webp');
            ffmpeg(inputPath)
              .setDuration(3)
              .outputOptions([
                '-vf fps=12,scale=384:384:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
                '-vcodec libwebp',
                '-lossless 0',
                '-compression_level 2',
                '-q:v 25',
                '-loop 0',
                '-an',
                '-threads 0'
              ])
              .save(compressedPath)
              .on('end', async () => {
                await fs.rename(compressedPath, outputPath);
                resolve(outputPath);
              })
              .on('error', () => resolve(outputPath));
          } else {
            resolve(outputPath);
          }
        } catch (e) {
          resolve(outputPath);
        }
      })
      .on('error', (err: any) => {
        reject(new Error(`فشل تحويل استكر الفيديو: ${err.message}`));
      });
  });
}

/**
 * تحويل الاستكر المتحرك بصيغة TGS (Lottie vector) عبر محرك TgsEngine فائق السرعة
 */
export async function convertTgsSticker(inputPath: string, outputPath: string): Promise<string> {
  return await tgsEngine.convertTgs(inputPath, outputPath);
}

/**
 * دالة التحويل العامة التي تتعرف على النوع وتنفذ المناسب
 */
export async function convertSticker(
  inputPath: string,
  outputPath: string,
  type: StickerType
): Promise<string> {
  switch (type) {
    case 'static':
      return await convertStaticSticker(inputPath, outputPath);
    case 'video':
      return await convertVideoSticker(inputPath, outputPath);
    case 'animated':
      return await convertTgsSticker(inputPath, outputPath);
    default:
      return await convertStaticSticker(inputPath, outputPath);
  }
}
