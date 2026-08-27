import express from 'express';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs-extra';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 10000;

// إنشاء سيرفر لضمان بقاء التطبيق يعمل على Render وعدم إغلاقه
app.get('/', (req, res) => {
    res.send('ALI-MD WhatsApp Bot is Running Successfully!');
});

app.listen(PORT, () => {
    console.log(`🚀 Server is listening on port ${PORT}`);
});

// دالة تنزيل الوسائط بأمان لتجنب أي توقف للبوت
export async function handleAutoDownload(sock, msg) {
    try {
        if (!msg.message) return;
        const messageType = Object.keys(msg.message)[0];
        const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

        if (mediaTypes.includes(messageType)) {
            const buffer = await downloadMediaMessage(
                msg,
                'buffer',
                {},
                { logger: console }
            );

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
