import path from "path";
import fs from "fs";
import { getMainKeyboard } from "../utils/keyboard.js";
import { taskManager } from "../services/task-manager.js";
/**
 * إرسال ملف APK الخاص بتطبيق Sticker Maker US للمستخدم مباشرة مع الكيبورد السفلي
 */
export async function sendAppApk(ctx) {
    const apkPath = path.resolve(process.cwd(), "assets/StickerMakerUS.apk");
    if (!fs.existsSync(apkPath)) {
        await ctx.reply("❌ عذراً، ملف التطبيق غير متوفر حالياً في خادم البوت.", {
            ...getMainKeyboard(ctx.from?.id)
        });
        return;
    }
    const waitMsg = await ctx.reply("⏳ جاري رفع وإرسال تطبيق Sticker Maker US للأندرويد...");
    try {
        await ctx.replyWithDocument({
            source: apkPath,
            filename: "StickerMakerUS.apk"
        }, {
            caption: `📲 <b>تطبيق Sticker Maker US للأندرويد (APK)</b>\n\n` +
                `✅ <b>المميزات:</b>\n` +
                `• متوافق تماماً مع أحدث إصدارات أندرويد (بما فيها أندرويد 16).\n` +
                `• تصدير بنقرة واحدة إلى <b>WhatsApp</b> و <b>WhatsApp Business</b>.\n` +
                `• يدعم فتح واستيراد ملفات <code>.wastickers</code> المرسلة من البوت مباشرة.\n\n` +
                `📥 <b>طريقة التثبيت:</b>\n` +
                `1. اضغط على ملف APK أعلاه لتنزيله.\n` +
                `2. اضغط على الملف واختر <b>تثبيت / Install</b> (إذا ظهر تنبيه مصادر غير معروفة، فعّل السماح لتطبيق تليجرام).\n` +
                `3. بعد التثبيت، افتح أي ملف حزمة <code>.wastickers</code> يرسله البوت ليتم فتحه في التطبيق وإضافته فوراً! 🎉`,
            parse_mode: "HTML",
            ...getMainKeyboard(ctx.from?.id)
        });
    }
    catch (err) {
        console.error("فشل إرسال ملف APK:", err);
        await ctx.reply(`❌ تعذر إرسال التطبيق: ${err.message || "خطأ غير معروف"}`, {
            ...getMainKeyboard(ctx.from?.id)
        });
    }
    finally {
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => { });
    }
}
export async function handleApp(ctx) {
    await sendAppApk(ctx);
}
/**
 * رسالة الترحيب /start مع تثبيت الكيبورد السفلي الدائم
 */
export async function handleStart(ctx) {
    const welcomeMessage = `👋 <b>أهلاً بك في بوت Sticker Maker US!</b> 🎨\n\n` +
        `البوت الأسرع لتحويل استكرات وحزم تليجرام إلى واتساب مباشرة وبأعلى جودة.\n\n` +
        `⚡ <b>تم تحويل جميع الأوامر إلى أزرار سفلية سهلة!</b>\n` +
        `يمكنك الآن استخدام الأزرار في الكيبورد بالأسفل لتنفيذ كل شيء بنقرة واحدة دون الحاجة لكتابة أوامر:\n\n` +
        `• <b>📲 تحميل التطبيق (APK):</b> لتنزيل تطبيق الأندرويد المخصص.\n` +
        `• <b>📖 طريقة الاستخدام:</b> لشرح طريقة التحويل والاستيراد لواتساب.\n` +
        `• <b>⚡ حالة وسرعة البوت:</b> لمتابعة سرعة وأداء البوت المباشر.\n` +
        `• <b>❓ المساعدة والشرح:</b> للدعم الفني ومعايير المقاسات.\n\n` +
        `👇 <b>لبدء التحويل فوراً:</b> أرسل أي استكر أو رابط حزمة الآن وسيتم تحويله في ثوانٍ!`;
    await ctx.reply(welcomeMessage, {
        parse_mode: "HTML",
        ...getMainKeyboard(ctx.from?.id)
    });
}
/**
 * شرح طريقة الاستخدام والتحويل
 */
export async function handleHowToUse(ctx) {
    const text = `📖 <b>طريقة استخدام البوت بسهولة دون كتابة أوامر:</b>\n\n` +
        `1️⃣ <b>تحويل استكر مفرد:</b>\n` +
        `• أرسل أي استكر مباشرة للبوت في المحادثة (ثابت أو متحرك أو فيديو).\n` +
        `• سيقوم البوت بتحويله فوراً لملف <code>.webp</code> بمقاس واتساب القياسي (512×512).\n\n` +
        `2️⃣ <b>تحويل حزمة استكرات كاملة:</b>\n` +
        `• أرسل أي استكر ينتمي لحزمة أو رابط الحزمة (مثال: <code>https://t.me/addstickers/Animals</code>).\n` +
        `• سيقوم البوت تلقائياً بتجميع وتحويل الحزمة كاملة بالتوازي وتقسيمها إلى ملفات <code>.wastickers</code> جاهزة لواتساب.\n\n` +
        `3️⃣ <b>إضافة الاستكرات لواتساب:</b>\n` +
        `• اضغط زر <b>📲 تحميل التطبيق (APK)</b> أدناه لتثبيت التطبيق على هاتفك.\n` +
        `• اضغط على ملف <code>.wastickers</code> الناتج واختر <b>فتح بواسطة -> Sticker Maker US</b>.\n` +
        `• اضغط زر <b>إضافة إلى WhatsApp</b> ومبروك! 🎉`;
    await ctx.reply(text, {
        parse_mode: "HTML",
        ...getMainKeyboard(ctx.from?.id)
    });
}
/**
 * دليل المساعدة والشرح الفني
 */
export async function handleHelp(ctx) {
    const helpMessage = `📖 <b>دليل استيراد الاستكرات إلى واتساب:</b>\n\n` +
        `📱 <b>الخطوة 1: على الهاتف (Android):</b>\n` +
        `1. قم بتثبيت تطبيقنا المخصص <b>Sticker Maker US</b> (اضغط زر 📲 تحميل التطبيق أدناه).\n` +
        `2. عندما يرسل لك البوت ملف بصيغة <code>.wastickers</code>، اضغط عليه واختر: <b>فتح بواسطة (Open with) -> Sticker Maker US</b> (أو افتح التطبيق واضغط على <b>📥 استيراد حزمة</b>).\n` +
        `3. اضغط على زر: <b>إضافة إلى WhatsApp</b> أو <b>WhatsApp Business</b> ومبروك! 🎉\n\n` +
        `💻 <b>الخطوة 2: على الكمبيوتر / واتساب ويب:</b>\n` +
        `• يمكنك حفظ ملفات <code>.webp</code> الناتجة واستخدامها مباشرة في محادثات واتساب ويب.\n\n` +
        `⚙️ <b>المعايير المطبقة تلقائياً على كل استكر:</b>\n` +
        `✅ الأبعاد: 512×512 بكسل بدقة شفافة.\n` +
        `✅ الحجم: أقل من 100KB للثابت، وأقل من 500KB للمتحرك.\n` +
        `✅ الصيغة: WebP القياسية لواتساب.\n\n` +
        `💡 <b>للبدء:</b> أرسل استكر أو رابط حزمة الآن!`;
    await ctx.reply(helpMessage, {
        parse_mode: "HTML",
        ...getMainKeyboard(ctx.from?.id)
    });
}
/**
 * عرض حالة وسرعة البوت في الوقت الفعلي
 */
export async function handleBotStatus(ctx) {
    const uptimeSec = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSec / 3600);
    const minutes = Math.floor((uptimeSec % 3600) / 60);
    const seconds = uptimeSec % 60;
    const uptimeStr = `${hours} ساعة و ${minutes} دقيقة و ${seconds} ثانية`;
    const activeTasks = taskManager.runningCount;
    const queuedTasks = taskManager.queuedCount;
    const statusText = `⚡ <b>حالة وأداء البوت الآن:</b>\n\n` +
        `🟢 <b>حالة الخادم:</b> متصل ويعمل على مدار الساعة (24/7)\n` +
        `⏱️ <b>مدة التشغيل المستمر:</b> ${uptimeStr}\n` +
        `🚀 <b>نظام المهام المتزامنة:</b> نشط (معالجة حتى 5 حزم في نفس اللحظة)\n` +
        `🔄 <b>المهام قيد المعالجة الآن:</b> ${activeTasks} مهمة\n` +
        `⏳ <b>المهام في قائمة الانتظار:</b> ${queuedTasks} مهمة\n` +
        `⚡ <b>سرعة الاستجابة:</b> فائقة (أقل من 100 مللي ثانية)\n` +
        `🎨 <b>الأنواع المدعومة:</b> صور ثابتة، فيديوهات WebM، وملفات TGS المتحركة\n` +
        `📦 <b>الصيغة المخرجة:</b> ملفات .wastickers الجاهزة لتطبيق واتساب بنقرة واحدة`;
    await ctx.reply(statusText, {
        parse_mode: "HTML",
        ...getMainKeyboard(ctx.from?.id)
    });
}
