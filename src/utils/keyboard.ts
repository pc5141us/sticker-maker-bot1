import { Markup } from "telegraf";
import { config } from "../config.js";

/**
 * كيبورد المستخدم العادي (يتضمن تحميل التطبيق، الشرح، الحالة، والمراسلة)
 */
export function getUserKeyboard() {
  return Markup.keyboard([
    ["📲 تحميل التطبيق (APK)", "📖 طريقة الاستخدام"],
    ["⚡ حالة وسرعة البوت", "❓ المساعدة والشرح"],
    ["✉️ تواصل مع إدارة البوت"]
  ]).resize();
}

/**
 * كيبورد الأدمن الرئيسي
 */
export function getAdminMainKeyboard() {
  return Markup.keyboard([
    ["👑 لوحة تحكم الأدمن", "⚡ حالة وسرعة البوت"],
    ["📢 إذاعة جماعية", "✉️ مراسلة مستخدم"],
    ["👥 قائمة المستخدمين", "⚡ المهام الجارية"],
    ["📲 تحميل التطبيق (APK)", "📖 طريقة الاستخدام"],
    ["❓ المساعدة والشرح"]
  ]).resize();
}

/**
 * كيبورد لوحة تحكم الأدمن المتقدمة (جميع التحكمات كأزرار كيبورد سفلية دون أي أزرار تحت الرسائل)
 */
export function getAdminDashboardKeyboard() {
  return Markup.keyboard([
    ["👑 لوحة تحكم الأدمن", "⚡ حالة وسرعة البوت"],
    ["📢 إذاعة جماعية", "✉️ مراسلة مستخدم"],
    ["👥 قائمة المستخدمين", "📁 تصدير المستخدمين"],
    ["⛔ حظر مستخدم", "🟢 فك حظر مستخدم"],
    ["⚡ المهام الجارية", "👁️ تجربة كيبورد المستخدم"],
    ["🔙 العودة للقائمة الرئيسية"]
  ]).resize();
}

/**
 * كيبورد الإلغاء والرجوع مع إمكانية فتح لوحة الأدمن دائماً
 */
export function getCancelKeyboard(cancelText: string = "❌ إلغاء العملية") {
  return Markup.keyboard([
    ["👑 لوحة تحكم الأدمن"],
    [cancelText, "🔙 رجوع"]
  ]).resize();
}

/**
 * توافقية مع الاسم القديم
 */
export function getAdminKeyboard() {
  return getAdminDashboardKeyboard();
}

/**
 * إرجاع الكيبورد المناسب بناءً على معرف المستخدم (User ID)
 */
export function getMainKeyboard(userId?: number) {
  if (userId === config.adminId) {
    return getAdminMainKeyboard();
  }
  return getUserKeyboard();
}
