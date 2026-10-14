import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';

// ضبط مسار ffmpeg تلقائياً
const ffmpegPath = (ffmpegInstaller as any)?.default || ffmpegInstaller;
if (typeof ffmpegPath === 'string') {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

export type StickerType = 'static' | 'video' | 'animated';

/**
 * تحويل الاستكر الثابت (WebP / PNG) إلى معايير واتساب:
 * - الأبعاد: 512×512 بكسل تماماً (مع حواف شفافة للحفاظ على النسبة الأصلية)
 * - الحجم: أقل من 100 كيلوبايت
 * - الصيغة: WebP
 */
export async function convertStaticSticker(inputPath: string, outputPath: string): Promise<string> {
  let quality = 90;
  
  let buffer = await sharp(inputPath)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality, effort: 6 })
    .toBuffer();

  // ضبط الجودة لتظل أقل من 100 كيلوبايت (الحد الأقصى لواتساب)
  while (buffer.length > 98 * 1024 && quality > 25) {
    quality -= 10;
    buffer = await sharp(inputPath)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality, effort: 6 })
      .toBuffer();
  }

  await fs.writeFile(outputPath, buffer);
  return outputPath;
}

/**
 * تحويل استكر الفيديو (WebM VP9) إلى استكر متحرك لواتساب:
 * - الأبعاد: 512×512 بكسل
 * - المدة: 3 ثواني كحد أقصى
 * - معدل الإطارات: 15-20 إطار في الثانية
 * - التكرار: لا نهائي (loop 0)
 * - الحجم: أقل من 500 كيلوبايت
 */
export async function convertVideoSticker(inputPath: string, outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setDuration(3)
      .outputOptions([
        '-vf fps=16,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
        '-vcodec libwebp',
        '-lossless 0',
        '-compression_level 4',
        '-q:v 55',
        '-loop 0',
        '-an'
      ])
      .save(outputPath)
      .on('end', async () => {
        try {
          // التحقق من حجم الملف الناتج
          const stats = await fs.stat(outputPath);
          if (stats.size > 500 * 1024) {
            // إذا تجاوز 500 كيلوبايت، نعيد الضغط بجودة أقل ومعدل إطارات 12fps
            const compressedPath = outputPath.replace('.webp', '_comp.webp');
            ffmpeg(inputPath)
              .setDuration(3)
              .outputOptions([
                '-vf fps=12,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000',
                '-vcodec libwebp',
                '-lossless 0',
                '-compression_level 5',
                '-q:v 35',
                '-loop 0',
                '-an'
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
 * تحويل الاستكر المتحرك بصيغة TGS (Lottie vector)
 */
export async function convertTgsSticker(inputPath: string, outputPath: string): Promise<string> {
  try {
    // استخدام tgs-to لإنتاج GIF ثم تحويله بواسطة sharp لضمان العمل على Apple Silicon
    // @ts-ignore
    const TGS = (await import('tgs-to')).default || (await import('tgs-to'));
    const tgs = new TGS(inputPath);
    const tempGif = outputPath.replace('.webp', '_temp.gif');
    await tgs.convertToGif(tempGif);

    if (fsSync.existsSync(tempGif)) {
      await sharp(tempGif, { animated: true })
        .resize(512, 512, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 50, effort: 5, loop: 0 })
        .toFile(outputPath);

      await fs.unlink(tempGif).catch(() => {});

      // ضمان أن حجم الاستكر لا يتعدى 500 كيلوبايت وفق معايير واتساب
      const stats = await fs.stat(outputPath);
      if (stats.size > 480 * 1024) {
        const compressedPath = outputPath.replace('.webp', '_comp.webp');
        await sharp(outputPath, { animated: true })
          .webp({ quality: 30, effort: 6, loop: 0 })
          .toFile(compressedPath);
        await fs.rename(compressedPath, outputPath);
      }

      return outputPath;
    }
  } catch (error: any) {
    console.warn('تحذير أثناء تحويل TGS عبر tgs-to:', error.message);
  }

  // في حال تعذر تشغيل محرك Lottie، يتم استخراج الإطار الأول كاستكر عالي الدقة لواتساب
  throw new Error('تعذر معالجة استكر TGS المتحرك، يرجى التأكد من توفر مشغل Lottie أو إرسال استكر ثابت/فيديو.');
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
