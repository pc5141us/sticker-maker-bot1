import { Markup } from 'telegraf';
import fs from 'fs';
import { config } from '../config.js';
import { db } from '../services/db.js';
import { taskManager } from '../services/task-manager.js';
import { escapeHtml } from '../utils/helpers.js';
import { getCancelKeyboard, getUserKeyboard, getAdminDashboardKeyboard } from '../utils/keyboard.js';
import { handleBotStatus } from './commands.js';
const adminSessions = new Map();
export function isAdmin(ctx) {
    return ctx.from?.id === config.adminId;
}
export function getAdminSession(adminId) {
    if (!adminSessions.has(adminId)) {
        adminSessions.set(adminId, { action: null });
    }
    return adminSessions.get(adminId);
}
export function clearAdminSession(adminId) {
    adminSessions.delete(adminId);
}
/**
 * لوحة التحكم الرئيسية للأدمن (لوحة مفاتيح سفلية كاملة دون أي أزرار تحت الرسائل)
 */
export async function handleAdminDashboard(ctx) {
    if (!isAdmin(ctx)) {
        await ctx.reply('⛔ هذا القسم مخصص لمالك البوت فقط.', { ...getUserKeyboard() });
        return;
    }
    // مزامنة فورية من النسخة السحابية لضمان دقة الإحصائيات
    await db.syncFromTelegram(ctx.telegram, config.adminId).catch(() => { });
    const stats = db.getStats();
    const runningTasks = taskManager.runningCount;
    const queuedTasks = taskManager.queuedCount;
    const text = `👑 <b>لوحة تحكم مالك البوت المتقدمة:</b>\n\n` +
        `⚡ <b>حالة التزامن والمهام الحالية:</b>\n` +
        `• <b>المهام الجارية الآن بالتوازي:</b> ${runningTasks} (حد التزامن: ${taskManager.MAX_CONCURRENT_PACKS})\n` +
        `• <b>في قائمة الانتظار:</b> ${queuedTasks}\n\n` +
        `📊 <b>إحصائيات المستخدمين:</b>\n` +
        `• <b>إجمالي المستخدمين:</b> ${stats.totalUsers}\n` +
        `• <b>النشطون اليوم:</b> ${stats.activeToday}\n` +
        `• <b>المستخدمون الجدد اليوم:</b> ${stats.newToday}\n` +
        `• <b>المحظورون:</b> ${stats.blockedUsers}\n\n` +
        `👇 <b>جميع التحكمات متاحة في لوحة المفاتيح السفلية بالأسفل دون الحاجة لكتابة أوامر:</b>\n` +
        `• <b>📢 إذاعة جماعية:</b> إرسال رسالة لكل المشتركين.\n` +
        `• <b>✉️ مراسلة مستخدم:</b> التواصل المباشر مع أي مستخدم عبر البوت.\n` +
        `• <b>👥 قائمة المستخدمين:</b> استعراض المسجلين في البوت.\n` +
        `• <b>📁 تصدير المستخدمين:</b> تحميل قاعدة البيانات بصيغة JSON.\n` +
        `• <b>⛔ حظر مستخدم:</b> عرض المستخدمين غير المحظورين لحظره بنقرة زر.\n` +
        `• <b>🟢 فك حظر مستخدم:</b> عرض المستخدمين المحظورين لفك حظرهم بنقرة زر.\n` +
        `• <b>⚡ حالة وسرعة البوت:</b> فحص سرعة وأداء السيرفر.`;
    await ctx.reply(text, {
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
}
/**
 * بدء إجراء مراسلة مستخدم (لوحة مفاتيح سفلية تعرض أحدث المستخدمين بنقرة واحدة)
 */
export async function handleStartUserMessage(ctx, preselectedUserId) {
    if (!isAdmin(ctx))
        return;
    const session = getAdminSession(config.adminId);
    if (preselectedUserId) {
        session.action = 'awaiting_dm_text';
        session.targetUserId = preselectedUserId;
        const targetUser = db.getUser(preselectedUserId);
        const targetName = targetUser?.firstName || 'المستخدم';
        await ctx.reply(`✏️ <b>أرسل الآن الرسالة التي تريد توجيهها لـ ${escapeHtml(targetName)}:</b>\n` +
            `الأيدي (ID): <code>${preselectedUserId}</code>\n\n` +
            `💡 يمكنك إرسال أي رسالة: (نص، صورة، ملصق، فيديو، تسجيل صوتي، أو تحويل رسالة).\n` +
            `اضغط على زر <b>"❌ إلغاء المراسلة"</b> بالأسفل للتراجع.`, {
            parse_mode: 'HTML',
            ...getCancelKeyboard('❌ إلغاء المراسلة')
        });
        return;
    }
    session.action = 'awaiting_dm_target';
    const recentUsers = db.getAllUsers().filter(u => u.id !== config.adminId).slice(-6).reverse();
    const keyboardRows = [];
    for (const u of recentUsers) {
        const name = u.firstName || 'مستخدم';
        keyboardRows.push([`👤 ${name} (${u.id})`]);
    }
    keyboardRows.push(['👑 لوحة تحكم الأدمن']);
    keyboardRows.push(['❌ إلغاء المراسلة', '🔙 رجوع']);
    await ctx.reply(`✉️ <b>مراسلة مستخدم عبر البوت:</b>\n\n` +
        `• اضغط مباشرة على اسم المستخدم من لوحة المفاتيح بالأسفل.\n` +
        `• أو أرسل معرف المستخدم (User ID) بالأرقام في رسالة.\n\n` +
        `💡 اضغط على زر <b>"👑 لوحة تحكم الأدمن"</b> أو <b>"❌ إلغاء المراسلة"</b> للتراجع.`, {
        parse_mode: 'HTML',
        ...Markup.keyboard(keyboardRows).resize()
    });
}
/**
 * بدء إجراء حظر مستخدم من الكيبورد السفلي (عرض المستخدمين غير المحظورين في الأزرار)
 */
export async function handleStartBlockUser(ctx) {
    if (!isAdmin(ctx))
        return;
    // مزامنة سحابية أولاً للتأكد من أحدث قائمة مستخدمين
    await db.syncFromTelegram(ctx.telegram, config.adminId).catch(() => { });
    const session = getAdminSession(config.adminId);
    session.action = 'awaiting_block_id';
    // جلب كافة المستخدمين غير المحظورين (النشطين) باستثناء الأدمن
    const unblockedUsers = db.getAllUsers().filter(u => !u.isBlocked && u.id !== config.adminId).reverse();
    const keyboardRows = [];
    for (const u of unblockedUsers) {
        const name = u.firstName || 'مستخدم';
        keyboardRows.push([`⛔ حظر: ${name} (${u.id})`]);
    }
    keyboardRows.push(['👑 لوحة تحكم الأدمن']);
    keyboardRows.push(['❌ إلغاء الحظر', '🔙 رجوع']);
    if (unblockedUsers.length === 0) {
        await ctx.reply(`⛔ <b>حظر مستخدم من استخدام البوت:</b>\n\n` +
            `ℹ️ <b>لا يوجد مستخدمون نشطون مسجلون حالياً للحظر.</b>\n\n` +
            `• يمكنك إرسال معرف المستخدم (User ID) بالأرقام يدوياً هنا لحظره.\n` +
            `• أو اضغط على زر <b>"👑 لوحة تحكم الأدمن"</b> بالأسفل للعودة للوحة الرئيسية.`, {
            parse_mode: 'HTML',
            ...Markup.keyboard(keyboardRows).resize()
        });
        return;
    }
    await ctx.reply(`⛔ <b>حظر مستخدم من استخدام البوت:</b>\n\n` +
        `👥 <b>قائمة المستخدمين غير المحظورين (${unblockedUsers.length}):</b>\n` +
        `• اضغط مباشرة على اسم المستخدم من الأزرار بالأسفل لحظره فوراً بنقرة واحدة.\n` +
        `• أو أرسل معرف المستخدم (User ID) بالأرقام في رسالة.\n\n` +
        `💡 اضغط على <b>"👑 لوحة تحكم الأدمن"</b> أو <b>"❌ إلغاء الحظر"</b> للتراجع.`, {
        parse_mode: 'HTML',
        ...Markup.keyboard(keyboardRows).resize()
    });
}
/**
 * بدء إجراء فك حظر مستخدم من الكيبورد السفلي (عرض المستخدمين المحظورين في الأزرار)
 */
export async function handleStartUnblockUser(ctx) {
    if (!isAdmin(ctx))
        return;
    // مزامنة سحابية أولاً للتأكد من أحدث قائمة مستخدمين
    await db.syncFromTelegram(ctx.telegram, config.adminId).catch(() => { });
    const session = getAdminSession(config.adminId);
    session.action = 'awaiting_unblock_id';
    // جلب كافة المستخدمين المحظورين
    const blockedUsers = db.getAllUsers().filter(u => u.isBlocked).reverse();
    const keyboardRows = [];
    for (const u of blockedUsers) {
        const name = u.firstName || 'مستخدم';
        keyboardRows.push([`🟢 فك حظر: ${name} (${u.id})`]);
    }
    keyboardRows.push(['👑 لوحة تحكم الأدمن']);
    keyboardRows.push(['❌ إلغاء فك الحظر', '🔙 رجوع']);
    if (blockedUsers.length === 0) {
        await ctx.reply(`🟢 <b>إلغاء حظر مستخدم:</b>\n\n` +
            `ℹ️ <b>لا يوجد أي مستخدم محظور حالياً في البوت!</b> 🎉\n\n` +
            `• إذا كنت ترغب في فك حظر مستخدم يدوي، يمكنك كتابة معرفه (User ID) بالأرقام.\n` +
            `• أو اضغط على زر <b>"👑 لوحة تحكم الأدمن"</b> بالأسفل للعودة للوحة الرئيسية.`, {
            parse_mode: 'HTML',
            ...Markup.keyboard(keyboardRows).resize()
        });
        return;
    }
    await ctx.reply(`🟢 <b>إلغاء حظر مستخدم:</b>\n\n` +
        `🚫 <b>قائمة المستخدمين المحظورين حالياً (${blockedUsers.length}):</b>\n` +
        `• اضغط مباشرة على اسم المستخدم من الأزرار بالأسفل لفك حظره فوراً بنقرة واحدة.\n` +
        `• أو أرسل معرف المستخدم (User ID) بالأرقام في رسالة.\n\n` +
        `💡 اضغط على <b>"👑 لوحة تحكم الأدمن"</b> أو <b>"❌ إلغاء فك الحظر"</b> للتراجع.`, {
        parse_mode: 'HTML',
        ...Markup.keyboard(keyboardRows).resize()
    });
}
/**
 * عرض المهام الجارية في البوت في الوقت الفعلي
 */
export async function handleLiveTasks(ctx) {
    if (!isAdmin(ctx))
        return;
    const tasks = taskManager.getActiveTasks();
    if (tasks.length === 0) {
        await ctx.reply('💤 لا توجد مهام تحويل جارية حالياً، البوت في وضع الاستعداد.', {
            ...getAdminDashboardKeyboard()
        });
        return;
    }
    let msg = `⚡ <b>المهام الجارية في البوت الآن (${tasks.length}):</b>\n\n`;
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const durationSec = Math.round((Date.now() - t.startedAt.getTime()) / 1000);
        const progress = t.progressText ? `[${t.progressText}]` : '';
        const statusIcon = t.status === 'running' ? '🔄 قيد التحويل' : '⏳ في الانتظار';
        msg += `${i + 1}. <b>${escapeHtml(t.userName)}</b> (ID: <code>${t.userId}</code>)\n   • الحزمة: <code>${escapeHtml(t.packName)}</code>\n   • الحالة: ${statusIcon} ${progress}\n   • الوقت المنقضي: ${durationSec} ثانية\n\n`;
    }
    await ctx.reply(msg, {
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
}
/**
 * تنفيذ إذاعة جماعية لجميع مستخدمي البوت
 */
export async function executeBroadcast(ctx, messageText) {
    if (!isAdmin(ctx))
        return;
    const users = db.getActiveUsers();
    if (users.length === 0) {
        await ctx.reply('⚠️ لا يوجد مستخدمون في قاعدة البيانات بعد.', {
            ...getAdminDashboardKeyboard()
        });
        return;
    }
    const statusMsg = await ctx.reply(`📢 <b>بدء الإذاعة الجماعية المتزامنة...</b>\n` +
        `👥 المستهدفون: ${users.length} مستخدم\n` +
        `⏳ جاري الإرسال في الخلفية دون تعطيل عمل البوت...`, {
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
    // تشغيل الإذاعة
    setImmediate(async () => {
        let successCount = 0;
        let failCount = 0;
        let lastUpdate = Date.now();
        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            try {
                if (messageText) {
                    await ctx.telegram.sendMessage(user.id, messageText, { parse_mode: 'HTML' });
                }
                else if (ctx.message) {
                    await ctx.telegram.copyMessage(user.id, ctx.chat.id, ctx.message.message_id);
                }
                successCount++;
            }
            catch (err) {
                failCount++;
                console.warn(`تعذر إرسال الإذاعة للمستخدم ${user.id}:`, err.description || err.message);
            }
            const now = Date.now();
            if (now - lastUpdate > 3000 || i === users.length - 1) {
                lastUpdate = now;
                const progress = Math.round(((i + 1) / users.length) * 100);
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `📢 <b>جاري الإذاعة الجماعية (${progress}%)...</b>\n\n` +
                    `• تم بنجاح: ${successCount}\n` +
                    `• تعذر الإرسال: ${failCount}\n` +
                    `• المتبقي: ${users.length - (i + 1)}`, { parse_mode: 'HTML' }).catch(() => { });
            }
            await new Promise(r => setTimeout(r, 40));
        }
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `🎉 <b>اكتملت الإذاعة الجماعية بنجاح!</b>\n\n` +
            `• ✅ <b>تم التسليم لـ:</b> ${successCount} مستخدم\n` +
            `• ❌ <b>فشل التسليم لـ:</b> ${failCount} مستخدم\n` +
            `• 👥 <b>إجمالي المستهدفين:</b> ${users.length}`, { parse_mode: 'HTML' }).catch(() => { });
    });
}
/**
 * معالجة رسائل الأدمن أثناء انتظار الإذاعة، أو تحديد معرف المستخدم، أو كتابة الرسالة، أو الحظر
 */
export async function handleAdminMessageInterception(ctx) {
    if (!isAdmin(ctx))
        return false;
    const text = (ctx.message?.text || '').trim();
    if (!text)
        return false;
    // 1. تجاوز فوري وفتح لوحة تحكم الأدمن في أي وقت ومن أي شاشة بكافة الصيغ
    const isAdminDashboardTrigger = /^(👑\s*)?لوح[ةه]\s*(تحكم\s*)?([أا]دمن|ال[أا]دمن|التحكم)?$/i.test(text) ||
        /^[أا]دمن$/i.test(text) ||
        /^admin$/i.test(text) ||
        /^panel$/i.test(text) ||
        text === '👑 لوحة تحكم الأدمن' ||
        text === '👑 لوحة تحكم الادمن' ||
        text === 'لوحة تحكم الأدمن' ||
        text === 'لوحه تحكم الادمن' ||
        text === 'لوحة الأدمن' ||
        text === 'لوحه الادمن' ||
        text === 'لوحة الادمن' ||
        text === 'لوحه الأدمن' ||
        text.includes('لوحة تحكم') ||
        text.includes('لوحه تحكم');
    if (isAdminDashboardTrigger) {
        clearAdminSession(ctx.from.id);
        await handleAdminDashboard(ctx);
        return true;
    }
    // 2. فحص سرعة وحالة البوت المباشر في أي وقت
    if (text === '⚡ حالة وسرعة البوت' ||
        text === 'حالة وسرعة البوت' ||
        text === 'معرفة الحالة وسرعة البوت' ||
        text === 'معرفة حالة البوت' ||
        text === 'سرعة البوت' ||
        text === '/status' ||
        text === '/ping' ||
        /^(⚡\s*)?(حالة|سرعة|معرفة حالة)/i.test(text)) {
        clearAdminSession(ctx.from.id);
        await handleBotStatus(ctx);
        return true;
    }
    // 3. النقر المباشر على زر فك حظر مستخدم محدد (سواء كانت الجلسة نشطة أم لا)
    const unblockDirectMatch = text.match(/(?:🟢\s*)?فك\s*حظر(?:\s*:\s*.+)?\((\d+)\)/) ||
        text.match(/^(?:🟢\s*)?فك\s*حظر\s+(\d+)$/);
    if (unblockDirectMatch) {
        clearAdminSession(ctx.from.id);
        const targetId = parseInt(unblockDirectMatch[1], 10);
        db.unblockUser(targetId);
        await db.syncToTelegram(ctx.telegram, config.adminId);
        const targetUser = db.getUser(targetId);
        const name = targetUser?.firstName || targetId;
        await ctx.reply(`🟢 <b>تم إلغاء حظر المستخدم بنجاح:</b>\n\n` +
            `• <b>الاسم:</b> ${escapeHtml(String(name))}\n` +
            `• <b>الأيدي (ID):</b> <code>${targetId}</code>\n\n` +
            `✅ تم تحديث بيانات المستخدم في السحابة وأصبح بإمكانه استخدام البوت الآن.`, {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
        return true;
    }
    // 4. النقر المباشر على زر حظر مستخدم محدد (سواء كانت الجلسة نشطة أم لا)
    const blockDirectMatch = text.match(/(?:⛔\s*)?حظر(?:\s*:\s*.+)?\((\d+)\)/) ||
        text.match(/^(?:⛔\s*)?حظر\s+(\d+)$/);
    if (blockDirectMatch && !text.includes('فك')) {
        clearAdminSession(ctx.from.id);
        const targetId = parseInt(blockDirectMatch[1], 10);
        if (targetId === config.adminId) {
            await ctx.reply('⚠️ لا يمكنك حظر نفسك!', { ...getAdminDashboardKeyboard() });
            return true;
        }
        db.blockUser(targetId);
        await db.syncToTelegram(ctx.telegram, config.adminId);
        const targetUser = db.getUser(targetId);
        const name = targetUser?.firstName || targetId;
        await ctx.reply(`⛔ <b>تم حظر المستخدم بنجاح:</b>\n\n` +
            `• <b>الاسم:</b> ${escapeHtml(String(name))}\n` +
            `• <b>الأيدي (ID):</b> <code>${targetId}</code>\n\n` +
            `🔒 تم تحديث بيانات المستخدم في السحابة ولن يتمكن من استخدام البوت بعد الآن.`, {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
        return true;
    }
    // 5. النقر المباشر على زر مراسلة مستخدم من القائمة (👤 الاسم (ID))
    const dmUserMatch = text.match(/👤\s*.+\((\d+)\)/);
    if (dmUserMatch) {
        clearAdminSession(ctx.from.id);
        const targetId = parseInt(dmUserMatch[1], 10);
        await handleStartUserMessage(ctx, targetId);
        return true;
    }
    // 6. التحقق من أزرار الإلغاء أو الرجوع
    const cancelKeywords = [
        '❌ إلغاء', '❌ إلغاء العملية', '❌ إلغاء المراسلة', '❌ إلغاء الإذاعة',
        '❌ إلغاء الحظر', '❌ إلغاء فك الحظر', 'إلغاء', '/cancel', 'cancel',
        '🔙 رجوع', 'رجوع', '🔙 العودة', 'عودة', 'الرئيسية',
        '🔙 العودة للقائمة الرئيسية', '🔙 القائمة الرئيسية', 'القائمة الرئيسية', 'خروج'
    ];
    if (cancelKeywords.some(k => text === k || text.startsWith(k))) {
        clearAdminSession(ctx.from.id);
        await ctx.reply('🔙 <b>تمت العودة للوحة تحكم الأدمن.</b>', {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
        return true;
    }
    // التحقق من الجلسات القائمة
    const session = getAdminSession(ctx.from.id);
    if (!session.action)
        return false;
    // 1. استقبال رسالة الإذاعة
    if (session.action === 'awaiting_broadcast') {
        clearAdminSession(ctx.from.id);
        await executeBroadcast(ctx);
        return true;
    }
    // 2. استقبال معرف المستخدم المراد مراسلته (عند إدخال رقم يدوي)
    if (session.action === 'awaiting_dm_target') {
        let targetId = null;
        const parenMatch = text.match(/\((\d+)\)$/);
        if (parenMatch) {
            targetId = parseInt(parenMatch[1], 10);
        }
        else {
            const digits = text.replace(/[^\d]/g, '');
            if (digits)
                targetId = parseInt(digits, 10);
        }
        if (!targetId || isNaN(targetId)) {
            await ctx.reply('⚠️ <b>معرف المستخدم غير صالح.</b> يرجى اختيار مستخدم من الأزرار أو إدخال رقم (ID):', {
                parse_mode: 'HTML',
                ...getCancelKeyboard('❌ إلغاء المراسلة')
            });
            return true;
        }
        const targetUser = db.getUser(targetId);
        session.action = 'awaiting_dm_text';
        session.targetUserId = targetId;
        const name = targetUser ? `${targetUser.firstName} (${targetUser.username ? '@' + targetUser.username : ''})` : `المستخدم ${targetId}`;
        await ctx.reply(`✏️ <b>أرسل الآن رسالتك للمستخدم:</b> ${escapeHtml(name)}\n\n` +
            `يمكنك إرسال (نص، صورة، ملصق، فيديو، صوت، إلخ) وسيتم إيصالها له فوراً:`, {
            parse_mode: 'HTML',
            ...getCancelKeyboard('❌ إلغاء المراسلة')
        });
        return true;
    }
    // 3. استقبال محتوى الرسالة وإرسالها للمستخدم
    if (session.action === 'awaiting_dm_text' && session.targetUserId) {
        const targetId = session.targetUserId;
        clearAdminSession(ctx.from.id);
        try {
            await ctx.telegram.sendMessage(targetId, '💬 <b>رسالة واردة من إدارة البوت:</b>\n\n(يمكنك الرد في أي وقت بالضغط على زر "✉️ تواصل مع إدارة البوت" في لوحة المفاتيح بالأسفل)', {
                parse_mode: 'HTML',
                ...getUserKeyboard()
            }).catch(() => { });
            await ctx.telegram.copyMessage(targetId, ctx.chat.id, ctx.message.message_id);
            await ctx.reply(`✅ <b>تم تسليم رسالتك بنجاح للمستخدم:</b> <code>${targetId}</code>`, {
                parse_mode: 'HTML',
                ...getAdminDashboardKeyboard()
            });
        }
        catch (e) {
            await ctx.reply(`❌ <b>فشل تسليم الرسالة للمستخدم:</b> <code>${targetId}</code>\n${e.message}\n(قد يكون المستخدم حظر البوت أو أوقف حسابه)`, {
                parse_mode: 'HTML',
                ...getAdminDashboardKeyboard()
            });
        }
        return true;
    }
    // 4. استقبال معرف المستخدم المراد حظره يدوياً بالأرقام
    if (session.action === 'awaiting_block_id') {
        let targetId = null;
        const parenMatch = text.match(/\((\d+)\)$/);
        if (parenMatch) {
            targetId = parseInt(parenMatch[1], 10);
        }
        else {
            const digits = text.replace(/[^\d]/g, '');
            if (digits)
                targetId = parseInt(digits, 10);
        }
        clearAdminSession(ctx.from.id);
        if (!targetId || isNaN(targetId)) {
            await ctx.reply('❌ معرف غير صالح، تم إلغاء العملية.', { ...getAdminDashboardKeyboard() });
            return true;
        }
        if (targetId === config.adminId) {
            await ctx.reply('⚠️ لا يمكنك حظر نفسك!', { ...getAdminDashboardKeyboard() });
            return true;
        }
        db.blockUser(targetId);
        await db.syncToTelegram(ctx.telegram, config.adminId);
        const targetUser = db.getUser(targetId);
        const name = targetUser?.firstName || targetId;
        await ctx.reply(`⛔ <b>تم حظر المستخدم بنجاح:</b>\n\n` +
            `• <b>الاسم:</b> ${escapeHtml(String(name))}\n` +
            `• <b>الأيدي (ID):</b> <code>${targetId}</code>\n\n` +
            `🔒 لن يتمكن من استخدام البوت.`, {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
        return true;
    }
    // 5. استقبال معرف المستخدم المراد فك حظره يدوياً بالأرقام
    if (session.action === 'awaiting_unblock_id') {
        let targetId = null;
        const parenMatch = text.match(/\((\d+)\)$/);
        if (parenMatch) {
            targetId = parseInt(parenMatch[1], 10);
        }
        else {
            const digits = text.replace(/[^\d]/g, '');
            if (digits)
                targetId = parseInt(digits, 10);
        }
        clearAdminSession(ctx.from.id);
        if (!targetId || isNaN(targetId)) {
            await ctx.reply('❌ معرف غير صالح، تم إلغاء العملية.', { ...getAdminDashboardKeyboard() });
            return true;
        }
        db.unblockUser(targetId);
        await db.syncToTelegram(ctx.telegram, config.adminId);
        const targetUser = db.getUser(targetId);
        const name = targetUser?.firstName || targetId;
        await ctx.reply(`🟢 <b>تم إلغاء حظر المستخدم بنجاح:</b>\n\n` +
            `• <b>الاسم:</b> ${escapeHtml(String(name))}\n` +
            `• <b>الأيدي (ID):</b> <code>${targetId}</code>\n\n` +
            `✅ أصبح بإمكانه استخدام البوت الآن.`, {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
        return true;
    }
    return false;
}
/**
 * إرسال رسالة خاصة لمستخدم معين بالأيدي (أمر مختصر /msg اختياري)
 */
export async function handlePrivateMessageCommand(ctx) {
    if (!isAdmin(ctx))
        return;
    const text = ctx.message?.text || '';
    const match = text.match(/^\/(?:msg|send)\s+(\d+)\s+([\s\S]+)$/i);
    if (!match) {
        await handleStartUserMessage(ctx);
        return;
    }
    const targetId = parseInt(match[1], 10);
    const msgContent = match[2];
    try {
        await ctx.telegram.sendMessage(targetId, `💬 <b>رسالة خاصة من إدارة البوت:</b>\n\n${escapeHtml(msgContent)}\n\n(يمكنك الرد عبر زر "✉️ تواصل مع إدارة البوت" بالأسفل)`, {
            parse_mode: 'HTML',
            ...getUserKeyboard()
        });
        await ctx.reply(`✅ <b>تم إرسال الرسالة الخاصة للمستخدم:</b> <code>${targetId}</code> بنجاح.`, {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
    }
    catch (err) {
        await ctx.reply(`❌ تعذر إرسال الرسالة للمستخدم <code>${targetId}</code>:\n${err.message}`, {
            parse_mode: 'HTML',
            ...getAdminDashboardKeyboard()
        });
    }
}
/**
 * حظر مستخدم
 */
export async function handleBlockUser(ctx) {
    if (!isAdmin(ctx))
        return;
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
        await handleStartBlockUser(ctx);
        return;
    }
    const targetId = parseInt(parts[1], 10);
    if (isNaN(targetId)) {
        await ctx.reply('❌ الأيدي غير صالح.', { ...getAdminDashboardKeyboard() });
        return;
    }
    if (targetId === config.adminId) {
        await ctx.reply('⚠️ لا يمكنك حظر نفسك!', { ...getAdminDashboardKeyboard() });
        return;
    }
    db.blockUser(targetId);
    await db.syncToTelegram(ctx.telegram, config.adminId);
    await ctx.reply(`⛔ <b>تم حظر المستخدم:</b> <code>${targetId}</code> بنجاح. لن يتمكن من استخدام البوت.`, {
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
}
/**
 * إلغاء حظر مستخدم
 */
export async function handleUnblockUser(ctx) {
    if (!isAdmin(ctx))
        return;
    const text = ctx.message?.text || '';
    const parts = text.split(/\s+/);
    if (parts.length < 2) {
        await handleStartUnblockUser(ctx);
        return;
    }
    const targetId = parseInt(parts[1], 10);
    if (isNaN(targetId)) {
        await ctx.reply('❌ الأيدي غير صالح.', { ...getAdminDashboardKeyboard() });
        return;
    }
    db.unblockUser(targetId);
    await db.syncToTelegram(ctx.telegram, config.adminId);
    await ctx.reply(`🟢 <b>تم إلغاء حظر المستخدم:</b> <code>${targetId}</code> بنجاح.`, {
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
}
/**
 * عرض أحدث المستخدمين في البوت
 */
export async function handleListUsers(ctx) {
    if (!isAdmin(ctx))
        return;
    const all = db.getAllUsers();
    if (all.length === 0) {
        await ctx.reply('لا يوجد مستخدمون مسجلون بعد.', { ...getAdminDashboardKeyboard() });
        return;
    }
    const recent = all.slice(-20).reverse();
    let msg = `👥 <b>أحدث ${recent.length} مستخدمين في البوت:</b>\n\n`;
    for (let i = 0; i < recent.length; i++) {
        const u = recent[i];
        const username = u.username ? `@${u.username}` : 'بدون معرف';
        const status = u.isBlocked ? '⛔ محظور' : '🟢 نشط';
        msg += `${i + 1}. <b>${escapeHtml(u.firstName)}</b> (${username})\n   • ID: <code>${u.id}</code> [${status}]\n`;
    }
    msg += `\n💡 <i>يمكنك مراسلة أو حظر أي مستخدم مباشرة باستخدام أزرار لوحة المفاتيح بالأسفل.</i>`;
    await ctx.reply(msg, {
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
}
/**
 * تصدير قاعدة بيانات المستخدمين كملف JSON
 */
export async function handleExportUsers(ctx) {
    if (!isAdmin(ctx))
        return;
    const dbPath = db.getDbFilePath();
    if (!fs.existsSync(dbPath)) {
        await ctx.reply('الملف غير موجود حالياً.', { ...getAdminDashboardKeyboard() });
        return;
    }
    db.saveImmediate();
    const allUsers = db.getAllUsers();
    await ctx.replyWithDocument({ source: dbPath, filename: `users_backup_${Date.now()}.json` }, {
        caption: `📁 <b>نسخة احتياطية لقاعدة مستخدمي البوت:</b>\n\n` +
            `• إجمالي المستخدمين: ${allUsers.length} مستخدم\n` +
            `• النشطون: ${allUsers.filter(u => !u.isBlocked).length}\n` +
            `• المحظورون: ${allUsers.filter(u => u.isBlocked).length}\n` +
            `• التاريخ: ${new Date().toLocaleString('ar-EG')}`,
        parse_mode: 'HTML',
        ...getAdminDashboardKeyboard()
    });
}
