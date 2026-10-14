import { Context, Markup } from 'telegraf';
import path from 'path';
import fs from 'fs';

/**
 * إرسال ملف APK الخاص بتطبيق Sticker Maker US للمستخدم مباشرة
 */
export async function sendAppApk(ctx: Context) {
  const apkPath = path.resolve(process.cwd(), 'assets/StickerMakerUS.apk');
  if (!fs.existsSync(apkPath)) {
    await ctx.reply('❌ عذراً، ملف التطبيق غير متوفر حالياً في خادم البوت.');
    return;
  }

  const waitMsg = await ctx.reply('⏳ جاري رفع وإرسال تطبيق Sticker Maker US للأندرويد...');

  try {
    await ctx.replyWithDocument(
      {
        source: apkPath,
        filename: 'StickerMakerUS.apk'
      },
      {
        caption: `📲 <b>تطبيق Sticker Maker US للأندرويد (APK)</b>\n\n` +
          `✅ <b>المميزات:</b>\n` +
          `• متوافق تماماً مع أحدث إصدارات أندرويد (بما فيها أندرويد 16).\n` +
          `• تصدير بنقرة واحدة إلى <b>WhatsApp</b> و <b>WhatsApp Business</b>.\n` +
          `• يدعم فتح واستيراد ملفات <code>.wastickers</code> المرسلة من البوت مباشرة.\n\n` +
          `📥 <b>طريقة التثبيت:</b>\n` +
          `1. اضغط على ملف APK أعلاه لتنزيله.\n` +
          `2. اضغط على الملف واختر <b>تثبيت / Install</b> (إذا ظهر تنبيه مصادر غير معروفة، فعّل السماح لتطبيق تليجرام).\n` +
          `3. بعد التثبيت، افتح أي ملف حزمة <code>.wastickers</code> يرسله البوت ليتم فتحه في التطبيق وإضافته فوراً! 🎉`,
        parse_mode: 'HTML'
      }
    );
  } catch (err: any) {
    console.error('فشل إرسال ملف APK:', err);
    await ctx.reply(`❌ تعذر إرسال التطبيق: ${err.message || 'خطأ غير معروف'}`);
  } finally {
    await ctx.telegram.deleteMessage(ctx.chat!.id, waitMsg.message_id).catch(() => {});
  }
}

export async function handleApp(ctx: Context) {
  await sendAppApk(ctx);
}

export async function handleStart(ctx: Context) {
  const welcomeMessage = `👋 <b>أهلاً بك في بوت تحويل استكرات تليجرام إلى واتساب!</b> 🎨\n\n` +
    `هذا البوت يساعدك على تحويل أي استكر تليجرام أو حزمة كاملة إلى صيغة متوافقة 100% مع تطبيق واتساب.\n\n` +
    `---\n` +
    `⚡ <b>طريقة الاستخدام:</b>\n\n` +
    `1️⃣ <b>استكر مفرد:</b>\n` +
    `أرسل أي استكر مباشرة للبوت (ثابت، فيديو WebM، أو متحرك TGS)، وسيقوم البوت بتحويله فوراً إلى ملف <code>.webp</code> بمقاس <b>512×512</b> جاهز للاستخدام في واتساب.\n\n` +
    `2️⃣ <b>حزمة استكرات كاملة:</b>\n` +
    `أرسل رابط الحزمة، مثل:\n` +
    `<code>https://t.me/addstickers/Animals</code>\n` +
    `أو اسم الحزمة:\n` +
    `<code>/pack Animals</code>\n` +
    `وسيقوم البوت بتحميل الحزمة كاملة وتجهيزها في ملف:\n` +
    `📦 <b>.wastickers</b> (جاهز للإضافة بنقرة واحدة عبر تطبيقنا الخاص <b>Sticker Maker US</b>).\n\n` +
    `---\n` +
    `📲 <b>تطبيق الأندرويد:</b>\n` +
    `اضغط على الزر بالأسفل أو أرسل /app في أي وقت لتحميل تطبيقنا الخاص لإضافة الاستكرات مباشرة لواتساب!`;

  await ctx.reply(welcomeMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📲 تحميل تطبيق Sticker Maker US (APK)', 'download_app')]
    ])
  });
}

export async function handleHelp(ctx: Context) {
  const helpMessage = `📖 <b>دليل استيراد الاستكرات إلى واتساب:</b>\n\n` +
    `📱 <b>الخطوة 1: على الهاتف (Android):</b>\n` +
    `1. قم بتثبيت تطبيقنا المخصص <b>Sticker Maker US</b> (اضغط الزر أدناه لتحميله بصيغة APK).\n` +
    `2. عندما يرسل لك البوت ملف بصيغة <code>.wastickers</code>، اضغط عليه واختر: <b>فتح بواسطة (Open with) -> Sticker Maker US</b> (أو افتح التطبيق واضغط على <b>📥 استيراد حزمة</b>).\n` +
    `3. اضغط على زر: <b>إضافة إلى WhatsApp</b> أو <b>WhatsApp Business</b> ومبروك! 🎉\n\n` +
    `💻 <b>الخطوة 2: على الكمبيوتر / واتساب ويب:</b>\n` +
    `• يمكنك حفظ ملفات <code>.webp</code> الناتجة وإرسالها مباشرة كمستند أو استكر في محادثات واتساب ويب.\n\n` +
    `⚙️ <b>المعايير المطبقة تلقائياً على كل استكر:</b>\n` +
    `✅ الأبعاد: 512×512 بكسل بدقة شفافة.\n` +
    `✅ الحجم: أقل من 100KB للثابت، وأقل من 500KB للمتحرك.\n` +
    `✅ الصيغة: WebP القياسية لواتساب.\n\n` +
    `لأي استفسار أو بدء التحويل، أرسل استكر أو رابط حزمة الآن!`;

  await ctx.reply(helpMessage, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📲 تحميل تطبيق Sticker Maker US (APK)', 'download_app')]
    ])
  });
}
