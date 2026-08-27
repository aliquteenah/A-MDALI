import makeWASocket, { DisconnectReason, delay, downloadMediaMessage } from '@whiskeysockets/baileys';
import express from 'express';
import pino from 'pino';
import path from 'path';
import yts from 'yt-search';
import axios from 'axios';
import Sticker, { StickerTypes } from 'wa-sticker-formatter';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';

import './settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// الاتصال بقاعدة بيانات MongoDB
const MONGO_URI = process.env.MONGO_URI;

const SessionSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    data: { type: String, required: true }
});
const SessionModel = mongoose.model('Session', SessionSchema);

// نظام إدارة الجلسة سحابياً عبر MongoDB
async function useMongoAuthState() {
    const writeData = async (data, id) => {
        try {
            const value = JSON.stringify(data, null, 2);
            await SessionModel.findOneAndUpdate({ id }, { data: value }, { upsert: true });
        } catch (e) {
            console.error('خطأ في كتابة الجلسة:', e);
        }
    };

    const readData = async (id) => {
        try {
            const result = await SessionModel.findOne({ id });
            if (result && result.data) {
                return JSON.parse(result.data);
            }
        } catch (e) {
            return null;
        }
        return null;
    };

    const removeData = async (id) => {
        try {
            await SessionModel.deleteOne({ id });
        } catch (e) {}
    };

    const creds = (await readData('creds')) || makeWASocket.initAuthCreds();

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
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

let sock;
let currentPairingCode = '';
let statusMessage = '';

setInterval(() => {
    if (global.gc) global.gc();
}, 30000);

async function startBot() {
    if (MONGO_URI) {
        try {
            await mongoose.connect(MONGO_URI);
            console.log("✅ تم الاتصال بنجاح بقاعدة البيانات MongoDB!");
        } catch (err) {
            console.error("❌ فشل الاتصال بقاعدة البيانات:", err);
        }
    } else {
        console.log("⚠️ لم يتم ضبط رابط MONGO_URI في متغيرات البيئة.");
    }

    const { state, saveCreds } = await useMongoAuthState();
    
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
                await SessionModel.deleteMany({});
            }
            startBot();
        } else if (connection === 'open') {
            statusMessage = `✅ بوت ${global.botname} متصل وجاهز للعمل!`;
            currentPairingCode = '';
            console.log(statusMessage);
        }
    });

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

                if (command === 'ping') {
                    await sock.sendMessage(from, { text: `🏓 *Pong!* بوت ${global.botname} يعمل بنجاح.` }, { quoted: msg });
                } 
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
                else if (command === 'تشغيل' || command === 'play') {
                    if (!q) return await sock.sendMessage(from, { text: `❌ يرجى إدخال اسم المقطع` }, { quoted: msg });
                    await sock.sendMessage(from, { text: global.mess.wait }, { quoted: msg });
                    try {
                        const search = await yts(q);
                        const video = search.videos[0];
                        const res = await axios.post(`https://api.cobalt.tools/api/json`, { url: video.url, downloadMode: "audio" }, { headers: { "Accept": "application/json", "Content-Type": "application/json" } });
                        if (res.data?.url) {
                            await sock.sendMessage(from, { audio: { url: res.data.url }, mimetype: 'audio/mp4' }, { quoted: msg });
                        }
                    } catch (e) {
                        await sock.sendMessage(from, { text: global.mess.error }, { quoted: msg });
                    }
                }
            }
        }
    });
}

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8"><title>${global.botname}</title>
            <style>
                body { background: #0f172a; color: #fff; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e293b; padding: 30px; border-radius: 12px; text-align: center; width: 350px; }
                input, button { width: 100%; padding: 12px; margin-top: 10px; border-radius: 6px; border: none; }
                input { background: #0f172a; color: #fff; text-align: center; }
                button { background: #0284c7; color: #fff; font-weight: bold; cursor: pointer; }
                .code { font-size: 22px; color: #38bdf8; font-weight: bold; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>${global.botname}</h1>
                <form action="/pair" method="POST">
                    <input type="text" name="phone" placeholder="967717521122" required />
                    <button type="submit">طلب كود الربط</button>
                </form>
                ${currentPairingCode ? `<div class="code">الكود: ${currentPairingCode}</div>` : ''}
            </div>
        </body>
        </html>
    `);
});

app.post('/pair', async (req, res) => {
    let phone = req.body.phone.replace(/[^0-9]/g, '');
    if (phone && (!sock || !sock.authState.creds.registered)) {
        await delay(1500);
        let code = await sock.requestPairingCode(phone);
        currentPairingCode = code?.match(/.{1,4}/g)?.join("-") || code;
    }
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startBot();
});
