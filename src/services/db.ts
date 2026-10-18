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
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf8');
        const list: BotUser[] = JSON.parse(raw);
        for (const u of list) {
          this.users.set(u.id, u);
        }
        console.log(`📦 تم تحميل ${this.users.size} مستخدم من قاعدة البيانات.`);
      } catch (e: any) {
        console.error('❌ خطأ في قراءة ملف users.json:', e.message);
      }
    }
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
    } catch (e: any) {
      console.error('❌ خطأ في حفظ users.json:', e.message);
    }
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
