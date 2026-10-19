import fs from 'fs';
import path from 'path';

export interface BotUser {
  id: number;
  username?: string;
  firstName: string;
  lastName?: string;
  joinedAt: string;
  lastActive: string;
  isBlocked?: boolean;
}

class UserDatabase {
  private users: Map<number, BotUser> = new Map();
  private dbPath: string;
  private saveTimeout: NodeJS.Timeout | null = null;

  private lastSyncTime = 0;

  constructor() {
    const dataDir = process.env.VERCEL ? '/tmp/data' : path.resolve(process.cwd(), 'data');
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    } catch (e: any) {
      console.warn('⚠️ تعذر إنشاء مجلد data:', e.message);
    }
    this.dbPath = path.join(dataDir, 'users.json');
    this.load();
  }

  private load() {
    // 1. قراءة الملف الأصلي المضمن في الكود (حتى على Vercel Serverless)
    const seedPath = path.resolve(process.cwd(), 'data/users.json');
    if (fs.existsSync(seedPath)) {
      try {
        const raw = fs.readFileSync(seedPath, 'utf8');
        const list: BotUser[] = JSON.parse(raw);
        for (const u of list) {
          this.users.set(u.id, u);
        }
      } catch (e: any) {
        console.warn('تعذر قراءة seed users.json:', e.message);
      }
    }

    // 2. دمج أي مستخدمين مسجلين سابقاً في مسار التشغيل الحالي
    if (this.dbPath !== seedPath && fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const list: BotUser[] = JSON.parse(raw);
        for (const u of list) {
          this.users.set(u.id, u);
        }
      } catch (e: any) {
        console.error('❌ خطأ في قراءة ملف users.json:', e.message);
      }
    }

    console.log(`📦 تم تحميل ${this.users.size} مستخدم من قاعدة البيانات.`);
  }

  private scheduleSave() {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveImmediate();
      this.saveTimeout = null;
    }, 1000);
  }

  public saveImmediate() {
    try {
      const list = Array.from(this.users.values());
      const tempPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), 'utf8');
      fs.renameSync(tempPath, this.dbPath);

      // محاولة حفظ نسخة محلية أيضاً في بيئة التطوير إن كانت قابلة للكتابة
      const seedPath = path.resolve(process.cwd(), 'data/users.json');
      if (this.dbPath !== seedPath) {
        try {
          fs.writeFileSync(seedPath, JSON.stringify(list, null, 2), 'utf8');
        } catch {}
      }
    } catch (e: any) {
      console.error('❌ خطأ في حفظ users.json:', e.message);
    }
  }

  /**
   * استعادة ومزامنة المستخدمين من النسخة السحابية المحفوظة في تليجرام تلقائياً
   * (سحابة تليجرام هي المصدر النهائي المعتمد لحالة الحظر والنشاط)
   */
  public async syncFromTelegram(telegram: any, adminId: number, force = false): Promise<void> {
    const now = Date.now();
    // تخطي الطلبات المتكررة إذا تمت المزامنة حديثاً خلال آخر 5 ثوانٍ، ما لم يكن استدعاء إجباري
    if (!force && this.lastSyncTime && (now - this.lastSyncTime < 5000)) {
      return;
    }

    try {
      const chat = await telegram.getChat(adminId);
      const pinned = chat.pinned_message;
      if (!pinned) return;

      let jsonStr: string | null = null;
      if (pinned.text && pinned.text.startsWith('#BOT_USERS_DB')) {
        jsonStr = pinned.text.replace('#BOT_USERS_DB\n', '').trim();
      }

      if (jsonStr) {
        const list: BotUser[] = JSON.parse(jsonStr);
        let updatedCount = 0;
        for (const u of list) {
          const existing = this.users.get(u.id);
          if (!existing) {
            this.users.set(u.id, {
              id: u.id,
              username: u.username,
              firstName: u.firstName || 'مستخدم',
              lastName: u.lastName,
              joinedAt: u.joinedAt || new Date().toISOString(),
              lastActive: u.lastActive || new Date().toISOString(),
              isBlocked: !!u.isBlocked
            });
            updatedCount++;
          } else {
            // تحديث حالة الحظر وبيانات المستخدم إجبارياً من النسخة السحابية
            if (existing.isBlocked !== !!u.isBlocked) {
              console.log(`🔄 تحديث حالة الحظر للمستخدم ${u.id}: من ${existing.isBlocked} إلى ${!!u.isBlocked}`);
              existing.isBlocked = !!u.isBlocked;
              updatedCount++;
            }
            if (u.firstName) existing.firstName = u.firstName;
            if (u.lastName) existing.lastName = u.lastName;
            if (u.username) existing.username = u.username;
            if (u.lastActive && new Date(u.lastActive) > new Date(existing.lastActive)) {
              existing.lastActive = u.lastActive;
            }
          }
        }

        this.lastSyncTime = Date.now();
        if (updatedCount > 0) {
          console.log(`☁️ تمت مزامنة وتحديث ${updatedCount} مستخدم من تليجرام! (الإجمالي: ${this.users.size})`);
          this.saveImmediate();
        }
      }
    } catch (e: any) {
      console.warn('⚠️ تعذر مزامنة المستخدمين من تليجرام:', e.message);
    }
  }

  /**
   * حفظ نسخة سحابية مشفرة ومثبتة في محادثة الأدمن في تليجرام لمنع فقدان أي مستخدم أو حالة حظر نهائياً
   */
  public async syncToTelegram(telegram: any, adminId: number): Promise<boolean> {
    try {
      const list = Array.from(this.users.values());
      const json = JSON.stringify(list);

      // حفظ في رسالة نصية مثبتة بهدوء إذا كانت ضمن حد رسائل تليجرام
      if (json.length < 3500) {
        const text = `#BOT_USERS_DB\n${json}`;
        const chat = await telegram.getChat(adminId);
        const pinned = chat.pinned_message;

        if (pinned?.text?.startsWith('#BOT_USERS_DB')) {
          await telegram.editMessageText(adminId, pinned.message_id, undefined, text);
        } else {
          const msg = await telegram.sendMessage(adminId, text, { disable_notification: true });
          await telegram.pinChatMessage(adminId, msg.message_id, { disable_notification: true });
        }

        this.lastSyncTime = Date.now();
        this.saveImmediate();
        console.log(`☁️ تم حفظ ومزامنة ${list.length} مستخدم في سحابة تليجرام بنجاح.`);
        return true;
      }
    } catch (e: any) {
      if (e.message?.includes('message is not modified') || e.description?.includes('message is not modified')) {
        this.lastSyncTime = Date.now();
        return true;
      }
      console.warn('⚠️ فشل حفظ النسخة السحابية في تليجرام:', e.message);
    }
    return false;
  }

  /**
   * تسجيل المستخدم وتحديث نشاطه، مع إرجاع هل هو مستخدم جديد لأول مرة
   */
  public recordUser(data: {
    id: number;
    username?: string;
    firstName: string;
    lastName?: string;
  }): { isNew: boolean; totalCount: number; user: BotUser } {
    const now = new Date().toISOString();
    let user = this.users.get(data.id);
    let isNew = false;

    if (!user) {
      isNew = true;
      user = {
        id: data.id,
        username: data.username,
        firstName: data.firstName || 'مستخدم',
        lastName: data.lastName,
        joinedAt: now,
        lastActive: now,
        isBlocked: false
      };
      this.users.set(data.id, user);
      this.saveImmediate(); // حفظ فوري للمستخدمين الجدد
    } else {
      // تحديث البيانات وآخر ظهور
      user.firstName = data.firstName || user.firstName;
      user.lastName = data.lastName;
      user.username = data.username;
      user.lastActive = now;
      this.scheduleSave();
    }

    return {
      isNew,
      totalCount: this.users.size,
      user
    };
  }

  public getUser(id: number): BotUser | undefined {
    return this.users.get(id);
  }

  public getAllUsers(): BotUser[] {
    return Array.from(this.users.values());
  }

  public getActiveUsers(): BotUser[] {
    return Array.from(this.users.values()).filter(u => !u.isBlocked);
  }

  public isUserBlocked(id: number): boolean {
    return this.users.get(id)?.isBlocked === true;
  }

  public blockUser(id: number): boolean {
    const u = this.users.get(id);
    if (u) {
      u.isBlocked = true;
      this.saveImmediate();
      return true;
    }
    return false;
  }

  public unblockUser(id: number): boolean {
    const u = this.users.get(id);
    if (u) {
      u.isBlocked = false;
      this.saveImmediate();
      return true;
    }
    return false;
  }

  public getStats() {
    const all = Array.from(this.users.values());
    const totalUsers = all.length;
    const blockedUsers = all.filter(u => u.isBlocked).length;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const activeToday = all.filter(u => new Date(u.lastActive) >= todayStart).length;
    const newToday = all.filter(u => new Date(u.joinedAt) >= todayStart).length;

    return {
      totalUsers,
      blockedUsers,
      activeToday,
      newToday
    };
  }

  public getDbFilePath(): string {
    return this.dbPath;
  }
}

export const db = new UserDatabase();
