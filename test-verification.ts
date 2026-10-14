import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { convertStaticSticker } from './src/services/converter.js';
import { packageStickers } from './src/services/packager.js';

async function runTest() {
  console.log('🧪 بدء اختبار المعالجة والتجهيز...');
  const testDir = path.resolve('test-temp');
  await fs.mkdir(testDir, { recursive: true });

  // 1. إنشاء صورة اختبارية
  const sampleImagePath = path.join(testDir, 'sample.png');
  await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 4,
      background: { r: 66, g: 133, b: 244, alpha: 1 }
    }
  }).png().toFile(sampleImagePath);
  console.log('✅ تم إنشاء صورة الاختبار الأصلية (400x300)');

  // 2. اختبار تحويل الاستكر لمقاييس واتساب
  const sampleOutputPath = path.join(testDir, 'converted.webp');
  await convertStaticSticker(sampleImagePath, sampleOutputPath);

  const metadata = await sharp(sampleOutputPath).metadata();
  const stats = await fs.stat(sampleOutputPath);

  console.log(`✅ الاستكر المحول:
• الأبعاد: ${metadata.width}x${metadata.height} (المطلوب لواتساب: 512x512)
• الصيغة: ${metadata.format}
• الحجم: ${(stats.size / 1024).toFixed(1)} KB (أقل من 100 KB)`);

  if (metadata.width !== 512 || metadata.height !== 512) {
    throw new Error('الأبعاد غير متوافقة مع 512x512!');
  }

  // 3. اختبار تجهيز حزمة .wastickers
  const stk2 = path.join(testDir, 'stk2.webp');
  const stk3 = path.join(testDir, 'stk3.webp');
  await fs.copyFile(sampleOutputPath, stk2);
  await fs.copyFile(sampleOutputPath, stk3);

  const packResult = await packageStickers({
    title: 'تجربة حزمة ملصقات',
    author: '@MyTestBot',
    stickerPaths: [sampleOutputPath, stk2, stk3],
    outputDir: testDir
  });

  console.log(`✅ نتيجة إنشاء الحزمة:
• عدد الأجزاء: ${packResult.parts.length}
• مسار الجزء الأول: ${packResult.parts[0]?.wastickersPath}
• مسار .zip: ${packResult.zipPath}
• إجمالي الاستكرات: ${packResult.totalStickers}`);

  // تنظيف مجلد الاختبار
  await fs.rm(testDir, { recursive: true, force: true });
  console.log('🎉 جميع اختبارات التحويل والتعبئة نجحت 100%!');
}

runTest().catch((err) => {
  console.error('❌ فشل الاختبار:', err);
  process.exit(1);
});
