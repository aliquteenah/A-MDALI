import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs-extra';
import path from 'path';

// دالة تنزيل الوسائط بأمان لتجنب أي انهيار للبوت
export async function handleAutoDownload(sock, msg) {
    try {
        const messageType = Object.keys(msg.message)[0];
        const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

        if (mediaTypes.includes(messageType)) {
            // تحميل الوسائط كـ Buffer
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: console }
            );

            // إنشاء مجلد مؤقت للتحميلات
            const tempDir = './downloads';
            await fs.ensureDir(tempDir);

            const filePath = path.join(tempDir, `${Date.now()}_ali_media`);
            await fs.writeFile(filePath, buffer);
            
            console.log(`✅ [ALI-MD] تم تحميل الوسائط بنجاح: ${filePath}`);
            return filePath;
        }
    } catch (error) {
        console.error('❌ [ALI-MD] خطأ في تنزيل الوسائط:', error);
    }
}
