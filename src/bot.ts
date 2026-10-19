import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import https from 'https';
import { config } from './config.js';
import { db } from './services/db.js';
import { handleStart, handleHelp, handleApp, sendAppApk, handleHowToUse, handleBotStatus } from './handlers/commands.js';
import {
  getMainKeyboard,
  getCancelKeyboard,
  getUserKeyboard,
  getAdminKeyboard,
  getAdminMainKeyboard,
  getAdminDashboardKeyboard
} from './utils/keyboard.js';
import { handleSingleSticker } from './handlers/sticker.js';
import { handlePackConversion } from './handlers/pack.js';
import {
  isAdmin,
  handleAdminDashboard,
  executeBroadcast,
  handleAdminMessageInterception,
  handlePrivateMessageCommand,
  handleBlockUser,
  handleUnblockUser,
  handleListUsers,
  handleExportUsers,
  handleLiveTasks,
  handleStartUserMessage,
  handleStartBlockUser,
  handleStartUnblockUser,
  getAdminSession,
  clearAdminSession
} from './handlers/admin.js';
import { extractPackName, escapeHtml } from './utils/helpers.js';

let botInstance: Telegraf | null = null;

// تعقب جلسات تواصل المستخدمين مع إدارة البوت
const userContactSessions = new Set<number>();

// وكيل HTTPS محسن فائق الاستجابة لمنع تجمد الاتصال
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 5000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 20000
});

export function createBot(): Telegraf {
  if (botInstance) {
    return botInstance;
  }

  if (!config.botToken) {
    throw new Error('لم يتم العثور على BOT_TOKEN في المتغيرات البيئية.');
  }

  const bot = new Telegraf(config.botToken, {
    telegram: {
      agent: httpsAgent
    },
    handlerTimeout: 900_000 // 15 دقيقة لمنع انتهاء المهلة في الحزم الكبيرة
  });

  // مزامنة قاعدة المستخدمين السحابية من تليجرام في الخلفية لمنع فقدان أي مستخدم
  db.syncFromTelegram(bot.telegram, config.adminId).catch(err => {
    console.warn('⚠️ تعذر المزامنة السحابية الأولية من تليجرام:', err.message);
  });

  // تحسين سرعة استقبال الرسائل بعد فترات الخمول
  const originalCallApi = bot.telegram.callApi.bind(bot.telegram);
  (bot.telegram as any).callApi = function (method: string, data: any, abortController?: any) {
    if (method === 'getUpdates' && data && typeof data === 'object') {
      data.timeout = 10;
    }
    return (originalCallApi as any)(method, data, abortController);
  };

  // 1. تسجيل كل مستخدم وحفظه في السحابة وإشعار الأدمن فوراً بالدخول الجديد مع زر للمراسلة
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      const { isNew, totalCount, user } = db.recordUser({
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name
      });

      // إشعار الأدمن فور انضمام مستخدم جديد لأول مرة مع زر تواصل مباشر!
      if (isNew && user.id !== config.adminId) {
        const userHandle = user.username ? `@${user.username}` : 'بدون معرف';
        const fullName = `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`;
        const joinDate = new Date().toLocaleString('ar-EG');
        bot.telegram.sendMessage(
          config.adminId,
          `🎉 <b>مستخدم جديد انضم للبوت!</b>\n\n` +
          `• <b>الاسم:</b> ${escapeHtml(fullName)}\n` +
          `• <b>المعرف:</b> ${userHandle}\n` +
          `• <b>الأيدي (ID):</b> <code>${user.id}</code>\n` +
          `• <b>الوقت:</b> ${joinDate}\n\n` +
          `👥 <b>إجمالي مستخدمي البوت الآن:</b> ${totalCount} مستخدم\n\n` +
          `💡 <i>لمراسلة أو حظر هذا المستخدم: استخدم أزرار لوحة المفاتيح بالأسفل.</i>`,
          {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
          }
        ).catch(err => console.warn('تعذر إرسال تنبيه المستخدم الجديد للأدمن:', err.message));

        // حفظ وتحديث النسخة السحابية بتليجرام تلقائياً
        db.syncToTelegram(bot.telegram, config.adminId).catch(() => {});
      }

      // التحقق من الحظر
      if (db.isUserBlocked(ctx.from.id) && ctx.from.id !== config.adminId) {
        if (ctx.message) {
          await ctx.reply('⛔ <b>عذراً، تم حظرك من استخدام البوت من قبل إدارة النظام.</b>', { parse_mode: 'HTML' });
        }
        return;
      }
    }

    return next();
  });

  // 2. اعتراض رسائل الأدمن أثناء جلسات الإذاعة، أو تحديد ID، أو كتابة رسالة لمستخدم، أو الحظر
  bot.use(async (ctx, next) => {
    if (ctx.from?.id === config.adminId && ctx.message) {
      const intercepted = await handleAdminMessageInterception(ctx);
      if (intercepted) return;
    }
    return next();
  });

  // 3. اعتراض واستقبال رسائل المستخدمين العاديين الموجهة للإدارة (تواصل مع الإدارة)
  bot.use(async (ctx, next) => {
    if (ctx.from && ctx.message && userContactSessions.has(ctx.from.id)) {
      const text = ((ctx.message as any)?.text || '').trim();
      const cancelKeywords = ['❌ إلغاء', '❌ إلغاء التواصل', 'إلغاء', 'cancel', '/cancel', '🔙 رجوع', 'رجوع'];

      if (cancelKeywords.includes(text)) {
        userContactSessions.delete(ctx.from.id);
        await ctx.reply('❌ تم إلغاء التواصل والعودة للقائمة الرئيسية.', {
          parse_mode: 'HTML',
          ...getUserKeyboard()
        });
        return;
      }

      userContactSessions.delete(ctx.from.id);

      const userHandle = ctx.from.username ? `@${ctx.from.username}` : 'بدون معرف';
      const fullName = `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`;
      const timeStr = new Date().toLocaleString('ar-EG');

      try {
        // إشعار الأدمن بالرسالة الواردة مع تفاصيل المستخدم وزر رد مباشر
        await bot.telegram.sendMessage(
          config.adminId,
          `📩 <b>رسالة واردة جديدة من مستخدم عبر البوت!</b>\n\n` +
          `• <b>من:</b> ${escapeHtml(fullName)}\n` +
          `• <b>المعرف:</b> ${userHandle}\n` +
          `• <b>الأيدي (ID):</b> <code>${ctx.from.id}</code>\n` +
          `• <b>الوقت:</b> ${timeStr}\n\n` +
          `💡 <i>للرد على هذا المستخدم: اضغط على زر "✉️ مراسلة مستخدم" في لوحة المفاتيح بالأسفل.</i>`,
          {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
          }
        );

        // نسخ محتوى الرسالة بكافة تفاصيله للأدمن
        await ctx.telegram.copyMessage(config.adminId, ctx.chat!.id, ctx.message!.message_id);

        await ctx.reply(
          `✅ <b>تم تسليم رسالتك لإدارة البوت بنجاح!</b>\n\n` +
          `سيتم الرد عليك هنا في المحادثة مباشرة في أقرب وقت. شكراً لتواصلك!`,
          {
            parse_mode: 'HTML',
            ...getUserKeyboard()
          }
        );
      } catch (err: any) {
        console.error('فشل إيصال رسالة المستخدم للأدمن:', err);
        await ctx.reply('❌ عذراً، تعذر إرسال الرسالة للإدارة في الوقت الحالي. يرجى المحاولة لاحقاً.', {
          ...getUserKeyboard()
        });
      }
      return;
    }

    return next();
  });

  // 4. تسجيل الأحداث للمتابعة المباشرة في الطرفية
  bot.use(async (ctx, next) => {
    const time = new Date().toLocaleTimeString('ar-EG');
    const sender = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'مستخدم');
    if (ctx.message) {
      const msgType = 'sticker' in ctx.message ? '🎨 استكر' : 'text' in ctx.message ? `💬 نص: ${ctx.message.text}` : '📁 ملف';
      console.log(`[${time}] استلام ${msgType} من ${sender}`);
    }
    return next();
  });

  // =================== أوامر الأدمن المخصصة (اختيارية للمحترفين) ===================
  bot.command(['admin', 'panel'], handleAdminDashboard);
  bot.command(['status', 'ping', 'speed'], handleBotStatus);
  bot.command(['bc', 'broadcast'], async (ctx) => {
    if (!isAdmin(ctx)) return;
    const text = ctx.message.text.replace(/^\/(?:bc|broadcast)(@\w+)?/i, '').trim();
    if (!text) {
      getAdminSession(config.adminId).action = 'awaiting_broadcast';
      await ctx.reply(
        '📢 <b>وضع الإذاعة الجماعية نشط الآن!</b>\n\n' +
        'أرسل الآن الرسالة التي تريد إذاعتها (نص، صورة، ملصق، فيديو، إلخ):',
        {
          parse_mode: 'HTML',
          ...getCancelKeyboard('❌ إلغاء الإذاعة')
        }
      );
      return;
    }
    await executeBroadcast(ctx, text);
  });
  bot.command(['msg', 'send'], handlePrivateMessageCommand);
  bot.command('block', handleBlockUser);
  bot.command('unblock', handleUnblockUser);
  bot.command('users', handleListUsers);
  bot.command(['export', 'export_users'], handleExportUsers);
  bot.command(['tasks', 'jobs'], handleLiveTasks);

  // =================== تفاعلات الأزرار المضمنة (Inline Buttons) ===================
  bot.action('admin_broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    getAdminSession(config.adminId).action = 'awaiting_broadcast';
    await ctx.reply(
      '📢 <b>وضع الإذاعة الجماعية نشط الآن!</b>\n\n' +
      'أرسل الآن أي رسالة وسيتم إذاعتها فوراً لجميع المستخدمين.',
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard('❌ إلغاء الإذاعة')
      }
    );
  });

  bot.action('admin_dm_start', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    await handleStartUserMessage(ctx);
  });

  bot.action('admin_live_tasks', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    await handleLiveTasks(ctx);
  });

  bot.action('admin_view_user_kb', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery('تم تفعيل كيبورد المستخدم');
    await ctx.reply('👁️ <b>تم تفعيل كيبورد المستخدم العادي لك للمعاينة:</b>\n(يمكنك العودة في أي وقت بالضغط على "👑 لوحة تحكم الأدمن" أو إرسال كلمة "أدمن")', {
      parse_mode: 'HTML',
      ...getUserKeyboard()
    });
  });

  bot.action('admin_restore_admin_kb', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery('تم استعادة كيبورد الأدمن');
    await ctx.reply('👑 <b>تمت استعادة كيبورد الأدمن بنجاح!</b>', {
      parse_mode: 'HTML',
      ...getAdminDashboardKeyboard()
    });
  });

  bot.action('admin_refresh_stats', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery('تم تحديث الإحصائيات');
    await handleAdminDashboard(ctx);
  });

  bot.action('admin_list_users', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    await handleListUsers(ctx);
  });

  bot.action('admin_export_users', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    await handleExportUsers(ctx);
  });

  bot.action('admin_bot_status', async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery('⚡ جاري فحص حالة وسرعة البوت...').catch(() => {});
    await handleBotStatus(ctx);
  });

  bot.action(['admin_cancel', 'admin_close'], async (ctx) => {
    if (!isAdmin(ctx)) return;
    clearAdminSession(config.adminId);
    await ctx.answerCbQuery('تم الإغلاق').catch(() => {});
    try {
      await ctx.deleteMessage();
    } catch {
      await ctx.editMessageText('🔙 تمت العودة للقائمة الرئيسية.');
    }
  });

  // زر مراسلة مستخدم معين بالأيدي
  bot.action(/^dm_user_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetUserId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    await handleStartUserMessage(ctx, targetUserId);
  });

  // زر حظر مستخدم من الإشعار أو القائمة
  bot.action(/^block_user_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetUserId = parseInt(ctx.match[1], 10);
    db.blockUser(targetUserId);
    await ctx.answerCbQuery(`تم حظر المستخدم ${targetUserId}`);
    await ctx.reply(`⛔ <b>تم حظر المستخدم:</b> <code>${targetUserId}</code> بنجاح.`, {
      parse_mode: 'HTML',
      ...getAdminDashboardKeyboard()
    });
  });

  // زر فك حظر مستخدم
  bot.action(/^unblock_user_(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return;
    const targetUserId = parseInt(ctx.match[1], 10);
    db.unblockUser(targetUserId);
    await ctx.answerCbQuery(`تم إلغاء حظر المستخدم ${targetUserId}`);
    await ctx.reply(`🟢 <b>تم إلغاء حظر المستخدم:</b> <code>${targetUserId}</code> بنجاح.`, {
      parse_mode: 'HTML',
      ...getAdminDashboardKeyboard()
    });
  });

  // زر رد المستخدم على رسالة الإدارة
  bot.action('user_reply_to_admin', async (ctx) => {
    if (ctx.from) {
      userContactSessions.add(ctx.from.id);
      await ctx.answerCbQuery('اكتب ردك الآن...');
      await ctx.reply(
        '💬 <b>أرسل الآن ردك على إدارة البوت:</b>\n\n' +
        'سيتم تسليم رسالتك للمالك فور إرسالها.\n' +
        '💡 اضغط على "❌ إلغاء التواصل" للتراجع.',
        {
          parse_mode: 'HTML',
          ...getCancelKeyboard('❌ إلغاء التواصل')
        }
      );
    }
  });

  // =================== أوامر واستقبال المستخدمين ===================
  bot.start(handleStart);
  bot.help(handleHelp);
  bot.command(['app', 'apk', 'download', 'program'], handleApp);

  bot.action('download_app', async (ctx) => {
    await ctx.answerCbQuery('📲 جاري إرسال التطبيق...').catch(() => {});
    await sendAppApk(ctx);
  });

  bot.command('pack', async (ctx) => {
    const text = ctx.message.text.replace(/^\/pack(@\w+)?/i, '').trim();
    if (!text) {
      await ctx.reply('ℹ️ يرجى إدخال اسم الحزمة أو رابطها بعد الأمر، مثال:\n`/pack Animals`', { parse_mode: 'Markdown' });
      return;
    }
    await handlePackConversion(ctx, text, { replyToMessageId: ctx.message?.message_id });
  });

  bot.on(message('sticker'), handleSingleSticker);

  // =================== أزرار الكيبورد السفلية (Reply Keyboard) ===================
  // 1. أزرار تحميل التطبيق
  bot.hears(['📲 تحميل التطبيق (APK)', '📲 تحميل التطبيق', /تحميل التطبيق/, /تحميل البرنامج/], handleApp);

  // 2. زر طريقة الاستخدام
  bot.hears(['📖 طريقة الاستخدام', '📖 طريقة الاستخدام والتحويل', /طريقة الاستخدام/], handleHowToUse);

  // 3. زر حالة وسرعة البوت
  bot.hears([
    '⚡ حالة وسرعة البوت',
    '⚡ معلومات وسرعة البوت',
    'حالة وسرعة البوت',
    'معرفة الحالة وسرعة البوت',
    'معرفة حالة البوت',
    'سرعة البوت',
    'حالة البوت',
    /^(⚡\s*)?(حالة|سرعة|معرفة حالة)/i
  ], handleBotStatus);

  // 4. زر المساعدة والشرح
  bot.hears(['❓ المساعدة والشرح', '❓ المساعدة والدعم', /المساعدة والشرح/], handleHelp);

  // 5. زر تواصل المستخدم مع إدارة البوت
  bot.hears(['✉️ تواصل مع إدارة البوت', '✉️ تواصل مع الإدارة', 'تواصل مع الإدارة', 'راسل الإدارة'], async (ctx) => {
    if (ctx.from) {
      userContactSessions.add(ctx.from.id);
      await ctx.reply(
        '💬 <b>تواصل مع إدارة البوت:</b>\n\n' +
        'أرسل الآن رسالتك أو استفسارك (نص، صورة، ملصق، تسجيل صوتي) وسيتم تسليمها لمالك البوت مباشرة.\n\n' +
        '💡 اضغط على زر "❌ إلغاء التواصل" بالأسفل للتراجع.',
        {
          parse_mode: 'HTML',
          ...getCancelKeyboard('❌ إلغاء التواصل')
        }
      );
    }
  });

  // 6. زر لوحة تحكم الأدمن
  bot.hears([
    '👑 لوحة تحكم الأدمن',
    '👑 لوحة تحكم الادمن',
    '👑 لوحة التحكم',
    '👑 لوحه التحكم',
    'لوحة تحكم الأدمن',
    'لوحه تحكم الادمن',
    'لوحة الأدمن',
    'لوحه الادمن',
    'لوحة الادمن',
    'لوحه الأدمن',
    'لوحة التحكم',
    'لوحه التحكم',
    'أدمن',
    'ادمن',
    'admin',
    'panel',
    /^(👑\s*)?لوح[ةه]\s*(تحكم\s*)?([أا]دمن|ال[أا]دمن|التحكم)?/i,
    /^(admin|أدمن|ادمن|panel)$/i
  ], async (ctx) => {
    if (!isAdmin(ctx)) {
      await ctx.reply('⚠️ هذا القسم مخصص لإدارة البوت فقط.', { ...getUserKeyboard() });
      return;
    }
    await handleAdminDashboard(ctx);
  });

  // 7. زر مراسلة مستخدم للأدمن من الكيبورد السفلي
  bot.hears(['✉️ مراسلة مستخدم', '✉️ مراسلة المشتركين', /مراسلة.*مستخدم/], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await handleStartUserMessage(ctx);
  });

  // 8. زر المهام الجارية للأدمن
  bot.hears(['⚡ المهام الجارية', /المهام الجارية/], async (ctx) => {
    if (!isAdmin(ctx)) {
      await handleBotStatus(ctx);
      return;
    }
    await handleLiveTasks(ctx);
  });

  // 9. زر الإذاعة الجماعية للأدمن
  bot.hears(['📢 إذاعة جماعية', /إذاعة جماعية/], async (ctx) => {
    if (!isAdmin(ctx)) return;
    getAdminSession(config.adminId).action = 'awaiting_broadcast';
    await ctx.reply(
      '📢 <b>وضع الإذاعة الجماعية نشط الآن!</b>\n\n' +
      'أرسل الآن أي رسالة (نص، صورة، ملصق، فيديو، توجيه) وسيتم إذاعتها فوراً لجميع المستخدمين.\n\n' +
      '💡 اضغط على زر "❌ إلغاء العملية" بالأسفل للتراجع في أي وقت.',
      {
        parse_mode: 'HTML',
        ...getCancelKeyboard('❌ إلغاء الإذاعة')
      }
    );
  });

  // 10. زر قائمة المستخدمين للأدمن
  bot.hears(['👥 قائمة المستخدمين', '👥 أحدث المستخدمين', /قائمة المستخدمين/], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await handleListUsers(ctx);
  });

  // 11. زر تصدير المستخدمين للأدمن
  bot.hears(['📁 تصدير المستخدمين', '📁 تصدير قاعدة البيانات', /تصدير.*المستخدمين/], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await handleExportUsers(ctx);
  });

  // 12. زر حظر مستخدم للأدمن (عرض قائمة المستخدمين غير المحظورين)
  bot.hears([
    '⛔ حظر مستخدم',
    'حظر مستخدم',
    /^(⛔\s*)?حظر\s*مستخدم/i
  ], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await handleStartBlockUser(ctx);
  });

  // 13. زر فك حظر مستخدم للأدمن (عرض قائمة المستخدمين المحظورين)
  bot.hears([
    '🟢 فك حظر مستخدم',
    '🟢 إلغاء حظر مستخدم',
    'فك حظر مستخدم',
    'إلغاء حظر مستخدم',
    /^(🟢\s*)?فك\s*حظر\s*مستخدم/i,
    /^(🟢\s*)?إلغاء\s*حظر\s*مستخدم/i
  ], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await handleStartUnblockUser(ctx);
  });

  // 14. زر تجربة كيبورد المستخدم للأدمن
  bot.hears(['👁️ تجربة كيبورد المستخدم', '👁️ كيبورد المستخدم'], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply('👁️ <b>تم تفعيل كيبورد المستخدم العادي لك للمعاينة:</b>\n(يمكنك العودة بالضغط على "👑 لوحة تحكم الأدمن" أو إرسال كلمة "أدمن")', {
      parse_mode: 'HTML',
      ...getUserKeyboard()
    });
  });

  // 15. زر استعادة كيبورد الأدمن
  bot.hears(['👑 كيبورد الأدمن', '👑 كيبورد الادمن'], async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.reply('👑 <b>تم تفعيل كيبورد الأدمن الكامل:</b>', {
      parse_mode: 'HTML',
      ...getAdminDashboardKeyboard()
    });
  });

  // 16. زر الرجوع والعودة للقائمة الرئيسية
  bot.hears([
    '🔙 العودة للقائمة الرئيسية',
    '🔙 القائمة الرئيسية',
    '🔙 رجوع',
    '🔙 العودة',
    'رجوع',
    'عودة',
    'الرئيسية',
    'القائمة الرئيسية',
    'خروج',
    /^(🔙|رجوع|العودة|الرئيسية)/
  ], async (ctx) => {
    if (isAdmin(ctx)) {
      clearAdminSession(config.adminId);
    }
    if (ctx.from) {
      userContactSessions.delete(ctx.from.id);
    }
    await ctx.reply('🔙 <b>تمت العودة للقائمة الرئيسية.</b>', {
      parse_mode: 'HTML',
      ...getMainKeyboard(ctx.from?.id)
    });
  });

  // 17. زر الإلغاء العام
  bot.hears([
    '❌ إلغاء',
    '❌ إلغاء العملية',
    '❌ إلغاء المراسلة',
    '❌ إلغاء الإذاعة',
    '❌ إلغاء الحظر',
    '❌ إلغاء فك الحظر',
    '❌ إلغاء التواصل',
    'إلغاء',
    'cancel',
    '/cancel'
  ], async (ctx) => {
    if (isAdmin(ctx)) {
      clearAdminSession(config.adminId);
    }
    if (ctx.from) {
      userContactSessions.delete(ctx.from.id);
    }
    await ctx.reply('❌ تم إلغاء العملية والعودة للقائمة الرئيسية.', {
      parse_mode: 'HTML',
      ...getMainKeyboard(ctx.from?.id)
    });
  });

  // 18. استقبال النصوص وحزم الاستكرات العامة
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return; // تجاهل الأوامر غير المعروفة

    // الاستجابة لطلبات تحميل التطبيق بالنصوص الطبيعية
    const appKeywords = [
      'تحميل التطبيق', 'تحميل البرنامج', 'تنزيل التطبيق', 'تنزيل البرنامج',
      'عايز البرنامج', 'عاوز البرنامج', 'عايز التطبيق', 'عاوز التطبيق',
      'ارسل البرنامج', 'ابعت البرنامج', 'ارسل التطبيق', 'ابعت التطبيق',
      'تطبيق', 'برنامج', 'apk', 'app'
    ];
    const isAppRequest = appKeywords.some(keyword => text.toLowerCase().includes(keyword));
    if (isAppRequest) {
      await sendAppApk(ctx);
      return;
    }

    const packName = extractPackName(text);
    if (packName) {
      await handlePackConversion(ctx, text, { replyToMessageId: ctx.message?.message_id });
    } else {
      await ctx.reply(
        '💡 <b>أهلاً بك! يمكنك استخدام البوت بنقرة واحدة عبر أزرار الكيبورد بالأسفل:</b>\n\n' +
        '• أرسل أي استكر مباشرة وسيقوم البوت بتحويله فوراً لواتساب.\n' +
        '• أو أرسل رابط حزمة تليجرام لتحويلها وتجميعها في ملف .wastickers.\n' +
        '• استخدم الأزرار بالأسفل لتحميل التطبيق أو معرفة طريقة الاستخدام أو فحص سرعة البوت أو التواصل مع الإدارة!',
        {
          parse_mode: 'HTML',
          ...getMainKeyboard(ctx.from?.id)
        }
      );
    }
  });

  // معالجة الأخطاء غير المتوقعة لمنع توقف البوت
  bot.catch((err: any, ctx) => {
    console.error(`❌ خطأ أثناء معالجة التحديث ${ctx.update?.update_id}:`, err);
  });

  botInstance = bot;
  return bot;
}
