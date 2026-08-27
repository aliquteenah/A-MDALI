import makeWASocket, { 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    initAuthCreds, 
    BufferJSON 
} from '@whiskeysockets/baileys';
import mongoose from 'mongoose';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// الاتصال بقاعدة بيانات MongoDB Atlas
const mongoURI = process.env.MONGO_URI;

if (!mongoURI) {
    console.error("❌ لم يتم تحديد متغير MONGO_URI في بيئة العمل!");
    process.exit(1);
}

mongoose.connect(mongoURI)
    .then(() => console.log("✅ ALI Bot: تم الاتصال بنجاح بقاعدة البيانات!"))
    .catch(err => {
        console.error("❌ ALI Bot: فشل الاتصال بقاعدة البيانات:", err.message);
        process.exit(1);
    });

// مخطط حفظ جلسة بوت ALI في MongoDB
const authSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    data: { type: String, required: true }
});

const AuthModel = mongoose.model('ALI_AuthKeys', authSchema);

// إدارة جلسة الحساب في MongoDB
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

let sock;

// الدالة الرئيسية لتشغيل بوت ALI
async function startBot() {
    const { state, saveCreds } = await useMongoAuthState();
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["ALI Bot", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🤖 ALI Bot: تم إغلاق الاتصال. جاري إعادة الاتصال...', shouldReconnect);
            if (shouldReconnect) {
                startBot();
            }
        } else if (connection === 'open') {
            console.log('✅ ALI Bot: تم الاتصال بالواتساب بنجاح وهو يعمل الآن!');
        }
    });

    // معالجة الرسائل القادمة لبوت ALI
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const body = msg.message.conversation || msg.message.extendedTextMessage?.text;

        // رد تلقائي بسيط كبداية لتجربة العمل
        if (body && body.toLowerCase() === 'test') {
            await sock.sendMessage(msg.key.remoteJid, { text: 'مرحباً بك! أنا بوت ALI، أعمل بنجاح عبر Render و MongoDB! 🤖✨' });
        }
    });
}

startBot();

// --- واجهة موقع ALI Bot لاستخراج كود الاقتران ---

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ALI WhatsApp Bot</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #0f172a; color: #fff; margin: 0; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; box-shadow: 0 8px 20px rgba(0,0,0,0.4); text-align: center; width: 320px; border: 1px solid #334155; }
                h2 { margin-bottom: 8px; color: #38bdf8; }
                p { font-size: 14px; color: #94a3b8; }
                input { width: 90%; padding: 12px; margin: 15px 0; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: #fff; text-align: center; font-size: 16px; outline: none; }
                button { width: 98%; padding: 12px; border: none; background: #0284c7; color: #fff; font-size: 16px; font-weight: bold; border-radius: 6px; cursor: pointer; transition: 0.3s; }
                button:hover { background: #0369a1; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>🤖 ALI WhatsApp Bot</h2>
                <p>ربط البوت باستخدام كود الاقتران</p>
                <form action="/pair" method="POST">
                    <input type="text" name="phone" placeholder="966500000000" required />
                    <button type="submit">طلب كود الاقتران</button>
                </form>
            </div>
        </body>
        </html>
    `);
});

app.post('/pair', async (req, res) => {
    let phone = req.body.phone;
    if (!phone) {
        return res.send('❌ يرجى إدخال رقم الهاتف.');
    }

    phone = phone.replace(/[^0-9]/g, '');

    try {
        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                const code = await sock.requestPairingCode(phone);
                res.send(`
                    <div style="text-align: center; font-family: sans-serif; background-color: #0f172a; color: #fff; padding: 50px; height: 100vh; box-sizing: border-box;">
                        <h2 style="color: #38bdf8;">🤖 ALI WhatsApp Bot</h2>
                        <h3>كود الاقتران الخاص بك:</h3>
                        <h1 style="color: #4ade80; font-size: 45px; letter-spacing: 6px;">${code}</h1>
                        <p style="color: #94a3b8;">افتح الواتساب -> الأجهزة المرتبطة -> ربط جهاز -> الربط برقم الهاتف وادخل الكود أعلاه.</p>
                        <br>
                        <a href="/" style="color: #38bdf8; text-decoration: none;">العودة للصفحة الرئيسية</a>
                    </div>
                `);
            }, 3000);
        } else {
            res.send(`
                <div style="text-align: center; font-family: sans-serif; background-color: #0f172a; color: #fff; padding: 50px; height: 100vh;">
                    <h2 style="color: #4ade80;">✅ ALI Bot مرتبط ومفعل بالفعل!</h2>
                    <p style="color: #94a3b8;">جلسة العمل محفوظة في MongoDB بنجاح.</p>
                </div>
            `);
        }
    } catch (error) {
        console.error(error);
        res.send('❌ حدث خطأ أثناء طلب الكود: ' + error.message);
    }
});

app.listen(PORT, () => {
    console.log(`ALI Bot server is running on port ${PORT}`);
});
