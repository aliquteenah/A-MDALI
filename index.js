import makeWASocket, { 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    initAuthCreds, 
    BufferJSON 
} from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import express from 'express';

// إعداد خادم Express لتفادي خطأ Port في Render
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('WhatsApp Bot is running successfully!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// الاتصال بقاعدة بيانات MongoDB Atlas
const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
    console.error("❌ لم يتم تحديد متغير MONGO_URI في بيئة العمل!");
    process.exit(1);
}

mongoose.connect(mongoURI)
    .then(() => console.log("✅ MongoDB! تم الاتصال بنجاح بقاعدة البيانات"))
    .catch(err => {
        console.error("❌ فشل الاتصال بقاعدة البيانات:", err.message);
        process.exit(1);
    });

// إنشاء مخطط Schema لحفظ جلسة البوت
const authSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    data: { type: String, required: true }
});

const AuthModel = mongoose.model('AuthKeys', authSchema);

// دالة إدارة جلسة الحساب في MongoDB بدلاً من المجلد المحلي
async function useMongoAuthState() {
    const readData = async (id) => {
        try {
            const document = await AuthModel.findOne({ id });
            if (document && document.data) {
                return JSON.parse(document.data, BufferJSON.reviver);
            }
        } catch (error) {
            console.error(`Error reading ${id}:`, error);
        }
        return null;
    };

    const writeData = async (id, data) => {
        try {
            const value = JSON.stringify(data, BufferJSON.replacer);
            await AuthModel.updateOne({ id }, { data: value }, { upsert: true });
        } catch (error) {
            console.error(`Error writing ${id}:`, error);
        }
    };

    const removeData = async (id) => {
        try {
            await AuthModel.deleteOne({ id });
        } catch (error) {
            console.error(`Error removing ${id}:`, error);
        }
    };

    // التصحيح الأساسي هنا: استدعاء initAuthCreds() المباشر دون makeWASocket
    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = makeWASocket.proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(key, value) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData('creds', creds)
    };
}

// الدالة الرئيسية لتشغيل البوت
async function startBot() {
    const { state, saveCreds } = await useMongoAuthState();
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('تم إغلاق الاتصال. إعادة الاتصال:', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ تم الاتصال بالواتساب بنجاح!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        
        // أضف أوامر البوت الخاصة بك هنا
    });
}

startBot();
