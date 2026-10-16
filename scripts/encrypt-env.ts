import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { encryptToken, maskToken } from '../src/services/security.js';

const envPath = path.resolve(process.cwd(), '.env');

if (!fs.existsSync(envPath)) {
  console.error('❌ ملف .env غير موجود في المجلد الحالي!');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = dotenv.parse(envContent);

if (!env.BOT_TOKEN && env.ENCRYPTED_BOT_TOKEN) {
  console.log('✅ التوكن مشفر بالفعل ومحمي بنجاح!');
  process.exit(0);
}

if (!env.BOT_TOKEN) {
  console.error('❌ لم يتم العثور على متغير BOT_TOKEN لتشفيره في ملف .env!');
  process.exit(1);
}

const plainToken = env.BOT_TOKEN.trim();
const encrypted = encryptToken(plainToken, env.BOT_MASTER_KEY);

// إعادة كتابة ملف .env باستبدال BOT_TOKEN الصريح بالتوكن المشفر
let newEnvContent = envContent;
if (newEnvContent.includes('BOT_TOKEN=')) {
  newEnvContent = newEnvContent.replace(/^BOT_TOKEN=.*$/m, `# التوكن مشفر بخوارزمية AES-256-GCM عالي الأمان\nENCRYPTED_BOT_TOKEN=${encrypted}`);
} else {
  newEnvContent += `\nENCRYPTED_BOT_TOKEN=${encrypted}\n`;
}

// إزالة أي أثر للتوكن القديم إذا كان مكرراً
newEnvContent = newEnvContent.replace(/^#?\s*BOT_TOKEN=.*/gm, '');

fs.writeFileSync(envPath, newEnvContent.trim() + '\n', 'utf8');

// ضبط الصلاحيات إلى 600 (قراءة وكتابة للمستخدم الحالي فقط)
try {
  fs.chmodSync(envPath, 0o600);
} catch (_) {}

console.log('=====================================================');
console.log('🔒 تم تشفير توكن البوت بنجاح وحمايته بخوارزمية AES-256-GCM!');
console.log(`🔑 التوكن المحمي: ${maskToken(plainToken)}`);
console.log('📁 تم تحديث ملف .env وحذف التوكن الصريح تماماً.');
console.log('🛡️ التشفير مقترن بعتاد جهازك، ولا يمكن فك تشفيره على أي جهاز آخر.');
console.log('=====================================================');
