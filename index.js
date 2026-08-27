import makeWASocket, { useMultiFileAuthState, DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import fs from 'fs-extra';
import path from 'path';
import yts from 'yt-search';
import axios from 'axios';
import Sticker, { StickerTypes } from 'wa-sticker-formatter';
import { fileURLToPath } from 'url';

import './settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;
let currentPairingCode = '';
let statusMessage = '';

// تنظيف دوري للذاكرة العشوائية لمنع الانهيار (Out of Memory)
setInterval(() => {
    if (global.gc) {
        global.gc();
    }
}, 60000);

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
            statusMessage = 'تم قطع الاتصال، جاري إعادة الاتصال...';
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                await fs.remove(sessionPath);
            }
            startBot();
        } else if (connection === 'open') {
            statusMessage = `✅ بوت ${global.botname} متصل وجاهز للعمل!`;
            currentPairingCode = '';
            console.log(statusMessage);
        }
    });

    // --- معالجة واستقبال الأوامر ---
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

            if (text.startsWith(global.prefix)) {
                const args = text.slice(global.prefix.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const q = args.join(' ');

                // 1. أمر الفحص (ping)
                if (command === 'ping') {
                    await sock.sendMessage(from, { text: `🏓 *Pong!* بوت ${global.botname} يعمل بنجاح.` }, { quoted: msg });
                } 

                // 2. القائمة الرئيسية (menu)
                else if (command === 'menu' || command === 'اوامر') {
                    const menuText = `
👑 *لوحة تحكم بوت ${global.botname}* 👑

• ${global.prefix}تشغيل <اسم الصوت> : تحميل صوتي من يوتيوب
• ${global.prefix}فيديو <اسم الفيديو> : تحميل فيديو من يوتيوب
• ${global.prefix}ملصق : تحويل الصورة لملصق
• ${global.prefix}ping : فحص سرعة الاستجابة
                    `;
                    await sock.sendMessage(from, { text: menuText }, { quoted: msg });
                }

                // 3. أمر تحميل الصوت (تشغيل / play)
                else if (command === 'تشغيل' || command === 'play') {
                    if (!q) return await sock.sendMessage(from, { text: `❌ يرجى إدخال اسم المقطع، مثال:\n${global.prefix}تشغيل سورة الملك` }, { quoted: msg });
                    
                    await sock.sendMessage(from, { text: global.mess.wait }, { quoted: msg });
                    try {
                        const search = await yts(q);
                        const video = search.videos[0];
                        if (!video) return await sock.sendMessage(from, { text: '❌ لم يتم العثور على نتائج.' }, { quoted: msg });

                        const apiUrl = `https://api.cobalt.tools/api/json`;
                        const res = await axios.post(apiUrl, {
                            url: video.url,
                            downloadMode: "audio"
                        }, { headers: { "Accept": "application/json", "Content-Type": "application/json" } });

                        if (res.data && res.data.url) {
                            await sock.sendMessage(from, { 
                                audio: { url: res.data.url }, 
                                mimetype: 'audio/mp4',
                                ptt: false 
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: `🎵 رابط المقطع:\n${video.url}` }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { text: global.mess.error }, { quoted: msg });
                    }
                }

                // 4. أمر تحميل الفيديو (فيديو / video)
                else if (command === 'فيديو' || command === 'video') {
                    if (!q) return await sock.sendMessage(from, { text: `❌ يرجى إدخال اسم الفيديو، مثال:\n${global.prefix}فيديو قرآن كريم` }, { quoted: msg });

                    await sock.sendMessage(from, { text: global.mess.wait }, { quoted: msg });
                    try {
                        const search = await yts(q);
                        const video = search.videos[0];
                        if (!video) return await sock.sendMessage(from, { text: '❌ لم يتم العثور على نتائج.' }, { quoted: msg });

                        const apiUrl = `https://api.cobalt.tools/api/json`;
                        const res = await axios.post(apiUrl, {
                            url: video.url,
                            downloadMode: "auto"
                        }, { headers: { "Accept": "application/json", "Content-Type": "application/json" } });

                        if (res.data && res.data.url) {
                            await sock.sendMessage(from, { 
                                video: { url: res.data.url }, 
                                caption: `🎥 *${video.title}*\n\nحقوق: ${global.botname}`
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: `🎬 رابط الفيديو:\n${video.url}` }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { text: global.mess.error }, { quoted: msg });
                    }
                }

                // 5. أمر الملصقات (ملصق / s)
                else if (command === 'ملصق' || command === 's') {
                    const isImage = messageType === 'imageMessage' || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
                    if (!isImage) return await sock.sendMessage(from, { text: '❌ قم بالرد على صورة أو أرسل صورة مع الأمر.' }, { quoted: msg });

                    try {
                        let targetMsg = msg.message.imageMessage ? msg : { message: msg.message.extendedTextMessage.contextInfo.quotedMessage };
                        const buffer = await downloadMediaMessage(targetMsg, 'buffer', {}, { logger: console });
                        
                        const sticker = new Sticker(buffer, {
                            pack: global.packname,
                            author: global.author,
                            type: StickerTypes.FULL,
                            quality: 50
                        });

                        const stickerBuffer = await sticker.toBuffer();
                        await sock.sendMessage(from, { sticker: stickerBuffer }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(from, { text: global.mess.error }, { quoted: msg });
                    }
                }
            }
        }
    });
}

// لوحة الربط عبر الويب
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${global.botname} - لوحة التحكم</title>
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
                <h1>👑 ${global.botname} BOT</h1>
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
