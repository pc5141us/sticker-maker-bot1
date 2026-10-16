import { Markup } from "telegraf";
import { config } from "../config.js";
/**
 * كيبورد المستخدم العادي (صفين مرتبين بأزرار واضحة تسهل الاستخدام دون الحاجة لكتابة أوامر)
 */
export function getUserKeyboard() {
    return Markup.keyboard([
        ["📲 تحميل التطبيق (APK)", "📖 طريقة الاستخدام"],
        ["⚡ حالة وسرعة البوت", "❓ المساعدة والشرح"]
    ]).resize().persistent();
}
/**
 * كيبورد الأدمن المتقدم (يتضمن جميع صلاحيات الإدارة وأزرار المستخدم)
 */
export function getAdminKeyboard() {
    return Markup.keyboard([
        ["👑 لوحة تحكم الأدمن", "⚡ المهام الجارية"],
        ["📢 إذاعة جماعية", "👥 قائمة المستخدمين"],
        ["📲 تحميل التطبيق (APK)", "📖 طريقة الاستخدام"],
        ["⚡ حالة وسرعة البوت", "❓ المساعدة والشرح"]
    ]).resize().persistent();
}
/**
 * كيبورد الإلغاء (يظهر أثناء وضع الإذاعة أو المراسلة الخاصة للتراجع بنقرة واحدة)
 */
export function getCancelKeyboard() {
    return Markup.keyboard([
        ["❌ إلغاء"]
    ]).resize().persistent();
}
/**
 * إرجاع الكيبورد المناسب بناءً على معرف المستخدم (User ID)
 */
export function getMainKeyboard(userId) {
    if (userId === config.adminId) {
        return getAdminKeyboard();
    }
    return getUserKeyboard();
}
