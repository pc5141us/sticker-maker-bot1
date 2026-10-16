import fs from 'fs';
import path from 'path';
class UserDatabase {
    users = new Map();
    dbPath;
    saveTimeout = null;
    constructor() {
        const dataDir = path.resolve(process.cwd(), 'data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        this.dbPath = path.join(dataDir, 'users.json');
        this.load();
    }
    load() {
        if (fs.existsSync(this.dbPath)) {
            try {
                const raw = fs.readFileSync(this.dbPath, 'utf8');
                const list = JSON.parse(raw);
                for (const u of list) {
                    this.users.set(u.id, u);
                }
                console.log(`📦 تم تحميل ${this.users.size} مستخدم من قاعدة البيانات.`);
            }
            catch (e) {
                console.error('❌ خطأ في قراءة ملف users.json:', e.message);
            }
        }
    }
    scheduleSave() {
        if (this.saveTimeout)
            return;
        this.saveTimeout = setTimeout(() => {
            this.saveImmediate();
            this.saveTimeout = null;
        }, 1000);
    }
    saveImmediate() {
        try {
            const list = Array.from(this.users.values());
            const tempPath = `${this.dbPath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(list, null, 2), 'utf8');
            fs.renameSync(tempPath, this.dbPath);
        }
        catch (e) {
            console.error('❌ خطأ في حفظ users.json:', e.message);
        }
    }
    /**
     * تسجيل المستخدم وتحديث نشاطه، مع إرجاع هل هو مستخدم جديد لأول مرة
     */
    recordUser(data) {
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
        }
        else {
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
    getUser(id) {
        return this.users.get(id);
    }
    getAllUsers() {
        return Array.from(this.users.values());
    }
    getActiveUsers() {
        return Array.from(this.users.values()).filter(u => !u.isBlocked);
    }
    isUserBlocked(id) {
        return this.users.get(id)?.isBlocked === true;
    }
    blockUser(id) {
        const u = this.users.get(id);
        if (u) {
            u.isBlocked = true;
            this.saveImmediate();
            return true;
        }
        return false;
    }
    unblockUser(id) {
        const u = this.users.get(id);
        if (u) {
            u.isBlocked = false;
            this.saveImmediate();
            return true;
        }
        return false;
    }
    getStats() {
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
    getDbFilePath() {
        return this.dbPath;
    }
}
export const db = new UserDatabase();
