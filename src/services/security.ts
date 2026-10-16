import crypto from 'crypto';
import os from 'os';
import { execSync } from 'child_process';

/**
 * اشتقاق مفتاح تشفير عالي الأمان (AES-256) مرتبط بالعتاد الفعلي للجهاز (Hardware-bound Key)
 * لمنع فك التشفير حتى لو تم نسخ ملف .env أو نقله إلى جهاز آخر.
 */
export function getHardwareSecretKey(customSecret?: string): Buffer {
  if (customSecret && customSecret.length >= 8) {
    return crypto.createHash('sha256').update(customSecret).digest();
  }

  let deviceUUID = '';
  try {
    if (process.platform === 'darwin') {
      const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      deviceUUID = output.split('"')[3] || '';
    } else if (process.platform === 'linux') {
      deviceUUID = execSync('cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    }
  } catch (_) {}

  const machineId = deviceUUID || os.hostname() || 'default-host-id';
  const salt = 'stickermakerus-aes256-shield-v1';
  return crypto.createHash('sha256').update(`${machineId}::${salt}::${os.userInfo().username}`).digest();
}

/**
 * تشفير التوكن بخوارزمية AES-256-GCM مع علامة مصادقة لمنع التلاعب
 */
export function encryptToken(token: string, customSecret?: string): string {
  const key = getHardwareSecretKey(customSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * فك تشفير التوكن في الذاكرة فقط عند تشغيل البوت
 */
export function decryptToken(encryptedPayload: string, customSecret?: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('صيغة التوكن المشفر غير صالحة.');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getHardwareSecretKey(customSecret);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * إخفاء التوكن في السجلات (Logs)
 */
export function maskToken(token: string): string {
  if (!token) return 'NONE';
  const parts = token.split(':');
  if (parts.length === 2) {
    return `${parts[0]}:***${parts[1].slice(-4)}`;
  }
  return token.length > 8 ? `${token.slice(0, 4)}***${token.slice(-4)}` : '***';
}
