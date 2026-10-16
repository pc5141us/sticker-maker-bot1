import { Telegraf, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import https from 'https';
import { config } from './config.js';
import { db } from './services/db.js';
import { handleStart, handleHelp, handleApp, sendAppApk, handleHowToUse, handleBotStatus } from './handlers/commands.js';
import { getMainKeyboard, getCancelKeyboard, getUserKeyboard, getAdminKeyboard } from './utils/keyboard.js';
import { handleSingleSticker } from './handlers/sticker.js';
import { handlePackConversion } from './handlers/pack.js';
import { isAdmin, handleAdminDashboard, executeBroadcast, handleAdminMessageInterception, handlePrivateMessageCommand, handleBlockUser, handleUnblockUser, handleListUsers, handleExportUsers, handleLiveTasks, getAdminSession, clearAdminSession } from './handlers/admin.js';
import { extractPackName, escapeHtml } from './utils/helpers.js';
let botInstance = null;
// وكيل HTTPS محسن فائق الاستجابة لمنع تجمد الاتصال
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 5000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 20000
});
export function createBot() {
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
    // تحسين سرعة استقبال الرسائل بعد فترات الخمول
    const originalCallApi = bot.telegram.callApi.bind(bot.telegram);
    bot.telegram.callApi = function (method, data, abortController) {
        if (method === 'getUpdates' && data && typeof data === 'object') {
            data.timeout = 10;
        }
        return originalCallApi(method, data, abortController);
    };
    // 1. تسجيل كل مستخدم وإشعار الأدمن فوراً بالدخول الجديد
    bot.use(async (ctx, next) => {
        if (ctx.from) {
            const { isNew, totalCount, user } = db.recordUser({
                id: ctx.from.id,
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name
            });
            // إشعار الأدمن عند دخول أي شخص جديد للبوت لأول مرة!
            if (isNew && user.id !== config.adminId) {
                const userHandle = user.username ? `@${user.username}` : 'بدون معرف';
                const fullName = `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`;
                const joinDate = new Date().toLocaleString('ar-EG');
                bot.telegram.sendMessage(config.adminId, `🎉 <b>مستخدم جديد انضم للبوت!</b>\n\n` +
                    `• <b>الاسم:</b> ${escapeHtml(fullName)}\n` +
                    `• <b>المعرف:</b> ${userHandle}\n` +
                    `• <b>الأيدي (ID):</b> <code>${user.id}</code>\n` +
                    `• <b>الوقت:</b> ${joinDate}\n\n` +
                    `👥 <b>إجمالي مستخدمي البوت الآن:</b> ${totalCount} مستخدم`, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(`✉️ مراسلة المستخدم`, `dm_user_${user.id}`)]
                    ])
                }).catch(err => console.warn('تعذر إرسال تنبيه المستخدم الجديد للأدمن:', err.message));
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
    // 2. اعتراض رسائل الأدمن أثناء وضع الإذاعة أو المراسلة الخاصة
    bot.use(async (ctx, next) => {
        if (ctx.from?.id === config.adminId && ctx.message) {
            const intercepted = await handleAdminMessageInterception(ctx);
            if (intercepted)
                return;
        }
        return next();
    });
    // 3. تسجيل الأحداث للمتابعة المباشرة في الطرفية
    bot.use(async (ctx, next) => {
        const time = new Date().toLocaleTimeString('ar-EG');
        const sender = ctx.from?.username ? `@${ctx.from.username}` : (ctx.from?.first_name || 'مستخدم');
        if (ctx.message) {
            const msgType = 'sticker' in ctx.message ? '🎨 استكر' : 'text' in ctx.message ? `💬 نص: ${ctx.message.text}` : '📁 ملف';
            console.log(`[${time}] استلام ${msgType} من ${sender}`);
        }
        return next();
    });
    // =================== أوامر الأدمن المخصصة ===================
    // أمر لوحة تحكم الأدمن
    bot.command(['admin', 'panel'], handleAdminDashboard);
    // أمر الإذاعة السريع: /bc أو /broadcast
    bot.command(['bc', 'broadcast'], async (ctx) => {
        if (!isAdmin(ctx))
            return;
        const text = ctx.message.text.replace(/^\/(?:bc|broadcast)(@\w+)?/i, '').trim();
        if (!text) {
            getAdminSession(config.adminId).action = 'awaiting_broadcast';
            await ctx.reply('📢 <b>أرسل الآن الرسالة التي تريد إذاعتها</b> (نص، صورة، ملصق، فيديو، إلخ):', { parse_mode: 'HTML' });
            return;
        }
        await executeBroadcast(ctx, text);
    });
    // أمر المراسلة الخاصة لمستخدم محدد: /msg أو /send
    bot.command(['msg', 'send'], handlePrivateMessageCommand);
    // أمر حظر مستخدم: /block
    bot.command('block', handleBlockUser);
    // أمر إلغاء حظر مستخدم: /unblock
    bot.command('unblock', handleUnblockUser);
    // أمر قائمة أحدث المستخدمين: /users
    bot.command('users', handleListUsers);
    // أمر تصدير قاعدة البيانات: /export
    bot.command(['export', 'export_users'], handleExportUsers);
    // أمر المهام المتزامنة الجارية في الوقت الفعلي: /tasks
    bot.command(['tasks', 'jobs'], handleLiveTasks);
    // =================== تفاعلات أزرار لوحة الأدمن ===================
    bot.action('admin_broadcast', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery();
        getAdminSession(config.adminId).action = 'awaiting_broadcast';
        await ctx.reply('📢 <b>وضع الإذاعة الجماعية نشط الآن!</b>\n\n' +
            'أرسل الآن أي رسالة (نص، صورة، ملصق، فيديو، تحويل) وسيتم إذاعتها فوراً لجميع المستخدمين.', {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ إلغاء الإذاعة', 'admin_cancel')]
            ])
        });
    });
    bot.action('admin_live_tasks', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery();
        await handleLiveTasks(ctx);
    });
    bot.action('admin_view_user_kb', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery('تم تفعيل كيبورد المستخدم');
        await ctx.reply('👁️ <b>تم تفعيل كيبورد المستخدم العادي لك للمعاينة والتجربة:</b>\n(يمكنك استعادة كيبورد الأدمن من زر "👑 كيبورد الأدمن" باللوحة أو كتابة /admin)', {
            parse_mode: 'HTML',
            ...getUserKeyboard()
        });
    });
    bot.action('admin_restore_admin_kb', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery('تم استعادة كيبورد الأدمن');
        await ctx.reply('👑 <b>تمت استعادة كيبورد الأدمن بنجاح!</b>', {
            parse_mode: 'HTML',
            ...getAdminKeyboard()
        });
    });
    bot.action('admin_refresh_stats', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery('تم تحديث الإحصائيات');
        await handleAdminDashboard(ctx);
    });
    bot.action('admin_list_users', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery();
        await handleListUsers(ctx);
    });
    bot.action('admin_export_users', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await ctx.answerCbQuery();
        await handleExportUsers(ctx);
    });
    bot.action('admin_cancel', async (ctx) => {
        if (!isAdmin(ctx))
            return;
        clearAdminSession(config.adminId);
        await ctx.answerCbQuery('تم الإلغاء');
        await ctx.editMessageText('❌ تم إلغاء العملية والعودة للوضع الطبيعي.');
    });
    // زر الرد السريع على مستخدم من إشعار الانضمام
    bot.action(/^dm_user_(\d+)$/, async (ctx) => {
        if (!isAdmin(ctx))
            return;
        const targetUserId = parseInt(ctx.match[1], 10);
        const session = getAdminSession(config.adminId);
        session.action = 'awaiting_dm_text';
        session.targetUserId = targetUserId;
        await ctx.answerCbQuery();
        await ctx.reply(`✉️ <b>أرسل الآن الرسالة الخاصة التي تريد توجيهها للمستخدم:</b> <code>${targetUserId}</code>`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('❌ إلغاء', 'admin_cancel')]
            ])
        });
    });
    // =================== أوامر واستقبال المستخدمين ===================
    // 1. الأوامر الأساسية
    bot.start(handleStart);
    bot.help(handleHelp);
    // 2. أوامر تحميل التطبيق
    bot.command(['app', 'apk', 'download', 'program'], handleApp);
    bot.action('download_app', async (ctx) => {
        await ctx.answerCbQuery('📲 جاري إرسال التطبيق...').catch(() => { });
        await sendAppApk(ctx);
    });
    // 3. أمر الحزمة اليدوي /pack
    bot.command('pack', async (ctx) => {
        const text = ctx.message.text.replace(/^\/pack(@\w+)?/i, '').trim();
        if (!text) {
            await ctx.reply('ℹ️ يرجى إدخال اسم الحزمة أو رابطها بعد الأمر، مثال:\n`/pack Animals`', { parse_mode: 'Markdown' });
            return;
        }
        await handlePackConversion(ctx, text, { replyToMessageId: ctx.message?.message_id });
    });
    // 4. استقبال الاستكرات الفردية وحزم الاستكرات تلقائياً
    bot.on(message('sticker'), handleSingleSticker);
    // =================== أزرار الكيبورد السفلية (Reply Keyboard) ===================
    // 1. أزرار تحميل التطبيق
    bot.hears(['📲 تحميل التطبيق (APK)', '📲 تحميل التطبيق', /تحميل التطبيق/, /تحميل البرنامج/], handleApp);
    // 2. زر طريقة الاستخدام
    bot.hears(['📖 طريقة الاستخدام', '📖 طريقة الاستخدام والتحويل', /طريقة الاستخدام/], handleHowToUse);
    // 3. زر حالة وسرعة البوت
    bot.hears(['⚡ حالة وسرعة البوت', '⚡ معلومات وسرعة البوت', /حالة.*البوت/, /سرعة.*البوت/], handleBotStatus);
    // 4. زر المساعدة والشرح
    bot.hears(['❓ المساعدة والشرح', '❓ المساعدة والدعم', /المساعدة والشرح/], handleHelp);
    // 5. زر لوحة تحكم الأدمن
    bot.hears(['👑 لوحة تحكم الأدمن', '👑 لوحة التحكم', /لوحة.*(الأدمن|التحكم)/], async (ctx) => {
        if (!isAdmin(ctx)) {
            await ctx.reply('⚠️ هذا القسم مخصص لإدارة البوت فقط.', { ...getMainKeyboard(ctx.from?.id) });
            return;
        }
        await handleAdminDashboard(ctx);
    });
    // 6. زر المهام الجارية للأدمن
    bot.hears(['⚡ المهام الجارية', /المهام الجارية/], async (ctx) => {
        if (!isAdmin(ctx)) {
            await handleBotStatus(ctx);
            return;
        }
        await handleLiveTasks(ctx);
    });
    // 7. زر الإذاعة الجماعية للأدمن
    bot.hears(['📢 إذاعة جماعية', /إذاعة جماعية/], async (ctx) => {
        if (!isAdmin(ctx))
            return;
        getAdminSession(config.adminId).action = 'awaiting_broadcast';
        await ctx.reply('📢 <b>وضع الإذاعة الجماعية نشط الآن!</b>\n\n' +
            'أرسل الآن أي رسالة (نص، صورة، ملصق، فيديو، توجيه) وسيتم إذاعتها فوراً لجميع المستخدمين.\n\n' +
            '💡 اضغط على زر "❌ إلغاء" بالأسفل للتراجع في أي وقت.', {
            parse_mode: 'HTML',
            ...getCancelKeyboard()
        });
    });
    // 8. زر قائمة المستخدمين للأدمن
    bot.hears(['👥 قائمة المستخدمين', '👥 أحدث المستخدمين', /قائمة المستخدمين/], async (ctx) => {
        if (!isAdmin(ctx))
            return;
        await handleListUsers(ctx);
    });
    // 9. زر الإلغاء العام
    bot.hears(['❌ إلغاء', '❌ إلغاء العملية', 'إلغاء', 'cancel'], async (ctx) => {
        if (isAdmin(ctx)) {
            clearAdminSession(config.adminId);
        }
        await ctx.reply('❌ تم إلغاء العملية والعودة للقائمة الرئيسية.', {
            parse_mode: 'HTML',
            ...getMainKeyboard(ctx.from?.id)
        });
    });
    // 5. استقبال النصوص وحزم الاستكرات
    bot.on(message('text'), async (ctx) => {
        const text = ctx.message.text.trim();
        if (text.startsWith('/'))
            return; // تجاهل الأوامر غير المعروفة
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
        }
        else {
            await ctx.reply('💡 <b>أهلاً بك! يمكنك استخدام البوت بنقرة واحدة عبر أزرار الكيبورد بالأسفل:</b>\n\n' +
                '• أرسل أي استكر مباشرة وسيقوم البوت بتحويله فوراً لواتساب.\n' +
                '• أو أرسل رابط حزمة تليجرام لتحويلها وتجميعها في ملف .wastickers.\n' +
                '• استخدم الأزرار بالأسفل لتحميل التطبيق أو معرفة طريقة الاستخدام أو فحص سرعة البوت!', {
                parse_mode: 'HTML',
                ...getMainKeyboard(ctx.from?.id)
            });
        }
    });
    // معالجة الأخطاء غير المتوقعة لمنع توقف البوت
    bot.catch((err, ctx) => {
        console.error(`❌ خطأ أثناء معالجة التحديث ${ctx.update?.update_id}:`, err);
    });
    botInstance = bot;
    return bot;
}
