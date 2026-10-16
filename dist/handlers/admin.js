import { Markup } from 'telegraf';
import fs from 'fs';
import { config } from '../config.js';
import { db } from '../services/db.js';
import { taskManager } from '../services/task-manager.js';
import { escapeHtml } from '../utils/helpers.js';
import { getMainKeyboard } from '../utils/keyboard.js';
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
 * لوحة التحكم الرئيسية للأدمن
 */
export async function handleAdminDashboard(ctx) {
    if (!isAdmin(ctx)) {
        await ctx.reply('⛔ هذا الأمر مخصص لمالك البوت فقط.');
        return;
    }
    const stats = db.getStats();
    const runningTasks = taskManager.runningCount;
    const queuedTasks = taskManager.queuedCount;
    const text = `👑 <b>لوحة تحكم مالك البوت:</b>\n\n` +
        `⚡ <b>حالة التزامن والمهام الحالية:</b>\n` +
        `• <b>المهام الجارية الآن بالتوازي:</b> ${runningTasks} (حد التزامن: ${taskManager.MAX_CONCURRENT_PACKS})\n` +
        `• <b>في قائمة الانتظار:</b> ${queuedTasks}\n\n` +
        `📊 <b>إحصائيات المستخدمين:</b>\n` +
        `• <b>إجمالي المستخدمين:</b> ${stats.totalUsers}\n` +
        `• <b>النشطون اليوم:</b> ${stats.activeToday}\n` +
        `• <b>المستخدمون الجدد اليوم:</b> ${stats.newToday}\n` +
        `• <b>المحظورون:</b> ${stats.blockedUsers}\n\n` +
        `⚡ <b>الأوامر السريعة:</b>\n` +
        `• <code>/bc نص الرسالة</code> للإذاعة لجميع المستخدمين\n` +
        `• <code>/msg [الأيدي] نص الرسالة</code> لإرسال رسالة خاصة\n` +
        `• <code>/block [الأيدي]</code> لحظر مستخدم\n` +
        `• <code>/unblock [الأيدي]</code> لإلغاء حظر مستخدم\n` +
        `• <code>/tasks</code> لمشاهدة المهام المتزامنة الجارية\n` +
        `• <code>/users</code> لعرض أحدث المستخدمين\n` +
        `• <code>/export</code> لتحميل نسخة احتياطية من المستخدمين`;
    await ctx.reply(text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [
                Markup.button.callback('📢 إذاعة رسالة جماعية', 'admin_broadcast'),
                Markup.button.callback('⚡ المهام الجارية', 'admin_live_tasks')
            ],
            [
                Markup.button.callback('👥 أحدث المستخدمين', 'admin_list_users'),
                Markup.button.callback('📊 تحديث اللوحة', 'admin_refresh_stats')
            ],
            [
                Markup.button.callback('👁️ كيبورد المستخدم', 'admin_view_user_kb'),
                Markup.button.callback('👑 كيبورد الأدمن', 'admin_restore_admin_kb')
            ],
            [
                Markup.button.callback('📁 تصدير المستخدمين (JSON)', 'admin_export_users'),
                Markup.button.callback('❌ إغلاق', 'admin_cancel')
            ]
        ])
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
        await ctx.reply('💤 لا توجد مهام تحويل جارية حالياً، البوت في وضع الاستعداد.');
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
    await ctx.reply(msg, { parse_mode: 'HTML' });
}
/**
 * تنفيذ إذاعة جماعية لجميع مستخدمي البوت في الخلفية دون تعطيل استجابة البوت
 */
export async function executeBroadcast(ctx, messageText) {
    if (!isAdmin(ctx))
        return;
    const users = db.getActiveUsers();
    if (users.length === 0) {
        await ctx.reply('⚠️ لا يوجد مستخدمون في قاعدة البيانات بعد.');
        return;
    }
    const statusMsg = await ctx.reply(`📢 <b>بدء الإذاعة الجماعية المتزامنة...</b>\n` +
        `👥 المستهدفون: ${users.length} مستخدم\n` +
        `⏳ جاري الإرسال في الخلفية دون تعطيل عمل البوت...`, { parse_mode: 'HTML' });
    // تشغيل الإذاعة في الخلفية
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
                if (err.description?.includes('blocked') || err.description?.includes('user is deactivated')) {
                    db.blockUser(user.id);
                }
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
 * معالجة رسائل الأدمن أثناء انتظار الإذاعة أو الرسائل الخاصة
 */
export async function handleAdminMessageInterception(ctx) {
    if (!isAdmin(ctx))
        return false;
    const session = getAdminSession(ctx.from.id);
    if (!session.action)
        return false;
    const text = ctx.message?.text || '';
    if (['❌ إلغاء', '❌ إلغاء العملية', 'إلغاء', '/cancel', 'cancel'].includes(text.trim())) {
        clearAdminSession(ctx.from.id);
        await ctx.reply('❌ تم إلغاء العملية والعودة للوضع الطبيعي.', {
            parse_mode: 'HTML',
            ...getMainKeyboard(ctx.from?.id)
        });
        return true;
    }
    if (session.action === 'awaiting_broadcast') {
        clearAdminSession(ctx.from.id);
        await executeBroadcast(ctx);
        return true;
    }
    if (session.action === 'awaiting_dm_text' && session.targetUserId) {
        const targetId = session.targetUserId;
        clearAdminSession(ctx.from.id);
        try {
            await ctx.telegram.copyMessage(targetId, ctx.chat.id, ctx.message.message_id);
            await ctx.reply(`✅ <b>تم تسليم الرسالة الخاصة للمستخدم بنجاح!</b>\n(ID: <code>${targetId}</code>)`, { parse_mode: 'HTML' });
        }
        catch (e) {
            await ctx.reply(`❌ <b>فشل إرسال الرسالة للمستخدم:</b>\n${e.message}`, { parse_mode: 'HTML' });
        }
        return true;
    }
    return false;
}
/**
 * إرسال رسالة خاصة لمستخدم معين بالأيدي
 */
export async function handlePrivateMessageCommand(ctx) {
    if (!isAdmin(ctx))
        return;
    const text = ctx.message?.text || '';
    const match = text.match(/^\/(?:msg|send)\s+(\d+)\s+([\s\S]+)$/i);
    if (!match) {
        await ctx.reply('ℹ️ <b>طريقة إرسال رسالة خاصة لمستخدم:</b>\n' +
            '<code>/msg [الأيدي] نص الرسالة</code>\n\n' +
            'مثال:\n' +
            '<code>/msg 123456789 مرحباً، تم تحديث ميزة جديدة بالبوت!</code>', { parse_mode: 'HTML' });
        return;
    }
    const targetId = parseInt(match[1], 10);
    const msgContent = match[2];
    try {
        await ctx.telegram.sendMessage(targetId, `💬 <b>رسالة خاصة من إدارة البوت:</b>\n\n${escapeHtml(msgContent)}`, { parse_mode: 'HTML' });
        await ctx.reply(`✅ <b>تم إرسال الرسالة الخاصة للمستخدم:</b> <code>${targetId}</code> بنجاح.`, { parse_mode: 'HTML' });
    }
    catch (err) {
        await ctx.reply(`❌ تعذر إرسال الرسالة للمستخدم <code>${targetId}</code>:\n${err.message}`, { parse_mode: 'HTML' });
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
        await ctx.reply('ℹ️ أرسل الأيدي بعد الأمر:\n<code>/block 123456789</code>', { parse_mode: 'HTML' });
        return;
    }
    const targetId = parseInt(parts[1], 10);
    if (isNaN(targetId)) {
        await ctx.reply('❌ الأيدي غير صالح.');
        return;
    }
    if (targetId === config.adminId) {
        await ctx.reply('⚠️ لا يمكنك حظر نفسك!');
        return;
    }
    db.blockUser(targetId);
    await ctx.reply(`⛔ <b>تم حظر المستخدم:</b> <code>${targetId}</code> بنجاح. لن يتمكن من استخدام البوت.`, { parse_mode: 'HTML' });
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
        await ctx.reply('ℹ️ أرسل الأيدي بعد الأمر:\n<code>/unblock 123456789</code>', { parse_mode: 'HTML' });
        return;
    }
    const targetId = parseInt(parts[1], 10);
    if (isNaN(targetId)) {
        await ctx.reply('❌ الأيدي غير صالح.');
        return;
    }
    db.unblockUser(targetId);
    await ctx.reply(`🟢 <b>تم إلغاء حظر المستخدم:</b> <code>${targetId}</code> بنجاح.`, { parse_mode: 'HTML' });
}
/**
 * عرض أحدث المستخدمين
 */
export async function handleListUsers(ctx) {
    if (!isAdmin(ctx))
        return;
    const all = db.getAllUsers();
    if (all.length === 0) {
        await ctx.reply('لا يوجد مستخدمون مسجلون بعد.');
        return;
    }
    const recent = all.slice(-25).reverse();
    let msg = `👥 <b>أحدث ${recent.length} مستخدمين في البوت:</b>\n\n`;
    for (let i = 0; i < recent.length; i++) {
        const u = recent[i];
        const username = u.username ? `@${u.username}` : 'بدون معرف';
        const status = u.isBlocked ? '⛔ محظور' : '🟢 نشط';
        msg += `${i + 1}. <b>${escapeHtml(u.firstName)}</b> (${username})\n   • ID: <code>${u.id}</code> [${status}]\n`;
    }
    await ctx.reply(msg, { parse_mode: 'HTML' });
}
/**
 * تصدير قاعدة بيانات المستخدمين كملف JSON
 */
export async function handleExportUsers(ctx) {
    if (!isAdmin(ctx))
        return;
    const dbPath = db.getDbFilePath();
    if (!fs.existsSync(dbPath)) {
        await ctx.reply('الملف غير موجود حالياً.');
        return;
    }
    db.saveImmediate();
    await ctx.replyWithDocument({ source: dbPath, filename: `users_backup_${Date.now()}.json` }, { caption: `📁 نسخة احتياطية من قاعدة مستخدمي البوت (${db.getAllUsers().length} مستخدم).` });
}
