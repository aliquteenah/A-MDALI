import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;
let currentPairingCode = '';
let statusMessage = '';

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth');
    
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["KHAN-MD Web", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            statusMessage = 'تم قطع الاتصال، جاري إعادة المحاولة...';
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            statusMessage = '✅ البوت متصل بالواتساب حالياً ويعمل بنجاح!';
            currentPairingCode = '';
            console.log(statusMessage);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const chat = m.key.remoteJid;
        const text = (m.message.conversation || m.message.extendedTextMessage?.text || '').trim();

        if (text === '.ping' || text === '.menu') {
            await sock.sendMessage(chat, { text: '🤖 بوت KHAN-MD يعمل بنجاح عبر لوحة الويب!' }, { quoted: m });
        }
    });
}

// الواجهة البرمجية للموقع
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>لوحة ربط KHAN-MD</title>
            <style>
                * { box-sizing: border-box; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
                body { background-color: #0f172a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
                .card { background: #1e293b; border-radius: 16px; padding: 30px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; }
                h1 { color: #a855f7; margin-bottom: 8px; font-size: 24px; }
                p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
                input { width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; text-align: center; font-size: 16px; margin-bottom: 15px; outline: none; }
                input:focus { border-color: #a855f7; }
                button { width: 100%; padding: 14px; border-radius: 8px; border: none; background: #9333ea; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }
                button:hover { background: #7e22ce; }
                .code-box { margin-top: 20px; padding: 15px; background: #0f172a; border-radius: 8px; border: 1px dashed #a855f7; }
                .code { font-size: 24px; font-weight: bold; color: #38bdf8; letter-spacing: 3px; }
                .status { margin-top: 15px; font-size: 13px; color: #22c55e; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>KHAN-MD Web Panel</h1>
                <p>أدخل رقم الهاتف مع رمز الدولة لطلب كود الربط</p>
                <form action="/pair" method="POST">
                    <input type="text" name="phone" placeholder="مثال: 966500000000" required />
                    <button type="submit">احصل على كود الربط</button>
                </form>
                ${currentPairingCode ? `
                    <div class="code-box">
                        <div>كود الربط الخاص بك:</div>
                        <div class="code">${currentPairingCode}</div>
                    </div>
                ` : ''}
                ${statusMessage ? `<div class="status">${statusMessage}</div>` : ''}
            </div>
        </body>
        </html>
    `);
});

app.post('/pair', async (req, res) => {
    let phone = req.body.phone.replace(/[^0-9]/g, '');
    if (!phone) {
        statusMessage = 'يرجى إدخال رقم هاتف صحيح';
        return res.redirect('/');
    }

    try {
        if (sock && !sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phone);
                    currentPairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
                    statusMessage = 'تم استخراج الكود بنجاح! أدخله في الواتساب.';
                    res.redirect('/');
                } catch (err) {
                    statusMessage = 'حدث خطأ أثناء طلب الكود، تحقق من الرقم.';
                    res.redirect('/');
                }
            }, 2000);
        } else {
            statusMessage = 'البوت متصل بالفعل أو غير جاهز لاستقبال كود.';
            res.redirect('/');
        }
    } catch (e) {
        statusMessage = 'تعذر الاتصال بالسيرفر.';
        res.redirect('/');
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    startBot();
});
