import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import fs from 'fs-extra';
import path from 'path';
import yts from 'yt-search';
import axios from 'axios';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;
let currentPairingCode = '';
let statusMessage = '';
const prefix = process.env.PREFIX || '.';

async function startBot() {
    const sessionPath = path.join(__dirname, 'session_auth');
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            statusMessage = 'تم قطع الاتصال، جاري إعادة المحاولة...';
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                await fs.remove(sessionPath);
            }
            startBot();
        } else if (connection === 'open') {
            statusMessage = '✅ ALI-MD متصل بالواتساب بنجاح!';
            currentPairingCode = '';
            console.log(statusMessage);
        }
    });

    // --- استقبال ومعالجة الأوامر والوسائط ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const messageType = Object.keys(msg.message)[0];
            
            const text = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || '';

            if (text.startsWith(prefix)) {
                const args = text.slice(prefix.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const q = args.join(' ');

                // 1. أمر الفحص
                if (command === 'ping') {
                    await sock.sendMessage(from, { text: '🏓 Pong! البوت يعمل بسرعة ممتازة.' }, { quoted: msg });
                } 

                // 2. أمر قائمة الأوامر
                else if (command === 'menu' || command === 'help') {
                    const menuText = `
✨ *قائمة أوامر ALI-MD* ✨

• ${prefix}ping : فحص استجابة البوت
• ${prefix}alive : فحص حالة البوت
• ${prefix}play <اسم المقطع> : تحميل صوت من يوتيوب
• ${prefix}song <اسم المقطع> : تحميل صوتية
• ${prefix}video <اسم الفيديو> : تحميل فيديو من يوتيوب
• ${prefix}s : تحويل الصورة إلى ملصق (قم بالرد على صورة)
                    `;
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }

                // 3. أمر تحميل الصوت (play / song)
                else if (command === 'play' || command === 'song') {
                    if (!q) return await sock.sendMessage(from, { text: `❌ يرجى كتابة اسم المقطع، مثال:\n${prefix}play قران كريم` }, { quoted: msg });
                    
                    await sock.sendMessage(from, { text: '🔍 جاري البحث والتحميل...' }, { quoted: msg });
                    try {
                        const search = await yts(q);
                        const video = search.videos[0];
                        if (!video) return await sock.sendMessage(from, { text: '❌ لم يتم العثور على أي نتائج.' }, { quoted: msg });

                        const apiRes = await axios.get(`https://api.vreden.web.id/api/ytmp3?url=${encodeURIComponent(video.url)}`);
                        const downloadUrl = apiRes.data?.result?.download?.url || apiRes.data?.result?.link;

                        if (downloadUrl) {
                            await sock.sendMessage(from, { 
                                audio: { url: downloadUrl }, 
                                mimetype: 'audio/mp4',
                                ptt: false 
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: `🎵 رابط المقطع على يوتيوب:\n${video.url}` }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء جلب المقطع الصوتي.' }, { quoted: msg });
                    }
                }

                // 4. أمر تحميل الفيديو (video)
                else if (command === 'video') {
                    if (!q) return await sock.sendMessage(from, { text: `❌ يرجى كتابة اسم الفيديو، مثال:\n${prefix}video فيديو مضحك` }, { quoted: msg });

                    await sock.sendMessage(from, { text: '🎬 جاري البحث وتحميل الفيديو...' }, { quoted: msg });
                    try {
                        const search = await yts(q);
                        const video = search.videos[0];
                        if (!video) return await sock.sendMessage(from, { text: '❌ لم يتم العثور على نتائج.' }, { quoted: msg });

                        const apiRes = await axios.get(`https://api.vreden.web.id/api/ytmp4?url=${encodeURIComponent(video.url)}`);
                        const downloadUrl = apiRes.data?.result?.download?.url || apiRes.data?.result?.link;

                        if (downloadUrl) {
                            await sock.sendMessage(from, { 
                                video: { url: downloadUrl }, 
                                caption: `🎥 *${video.title}*`
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: `🎬 رابط الفيديو:\n${video.url}` }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء تحميل الفيديو.' }, { quoted: msg });
                    }
                }

                // 5. أمر تحويل الصورة لملصق (s / sticker)
                else if (command === 's' || command === 'sticker') {
                    const isImage = messageType === 'imageMessage' || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                    if (!isImage) return await sock.sendMessage(from, { text: '❌ قم بالرد على صورة أو أرسل صورة مع الأمر .s' }, { quoted: msg });

                    try {
                        let targetMsg = msg.message.imageMessage ? msg : { message: msg.message.extendedTextMessage.contextInfo.quotedMessage };
                        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: console });
                        await sock.sendMessage(from, { sticker: buffer }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(from, { text: '❌ حدث خطأ أثناء إنشاء الملصق.' }, { quoted: msg });
                    }
                }
            }
        }
    });
}

// واجهة الويب لربط الحساب
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ALI-MD - لوحة الربط</title>
            <style>
                * { box-sizing: border-box; font-family: system-ui, sans-serif; }
                body { background-color: #0f172a; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
                .card { background: #1e293b; border-radius: 16px; padding: 30px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; }
                h1 { color: #38bdf8; margin-bottom: 8px; font-size: 26px; }
                p { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
                input { width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #fff; text-align: center; font-size: 16px; margin-bottom: 15px; outline: none; }
                button { width: 100%; padding: 14px; border-radius: 8px; border: none; background: #0284c7; color: #fff; font-size: 16px; font-weight: bold; cursor: pointer; }
                .code-box { margin-top: 20px; padding: 15px; background: #0f172a; border-radius: 8px; border: 1px dashed #38bdf8; }
                .code { font-size: 24px; font-weight: bold; color: #38bdf8; letter-spacing: 3px; }
                .status { margin-top: 15px; font-size: 13px; color: #22c55e; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>👑 ALI-MD BOT</h1>
                <p>أدخل رقم الهاتف مع رمز الدولة لطلب كود الربط</p>
                <form action="/pair" method="POST">
                    <input type="text" name="phone" placeholder="مثال: 966500000000" required />
                    <button type="submit">طلب كود الربط</button>
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
        if (!sock || !sock.authState.creds.registered) {
            await delay(1500);
            let code = await sock.requestPairingCode(phone);
            currentPairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
            statusMessage = 'تم استخراج الكود! أدخله فوراً في الواتساب.';
        } else {
            statusMessage = 'البوت متصل بالفعل.';
        }
    } catch (err) {
        statusMessage = 'حدث خطأ أثناء طلب الكود، أعد المحاولة.';
    }
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBot();
});
