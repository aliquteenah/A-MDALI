import fs from 'fs';

global.owner = ['967717521122']; // ضع رقمك مع رمز الدولة هنا
global.botname = 'ALI-MD';
global.packname = 'ALI-MD';
global.author = 'ALI';
global.prefix = '.';

global.mess = {
    wait: '⏳ *جاري التحميل والمعالجة... انتظر لحظة!*',
    success: '✅ *تم تنفيذ الطلب بنجاح!*',
    error: '❌ *حدث خطأ أثناء تنفيذ الأمر، أعد المحاولة.*',
    owner: '👑 *هذا الأمر مخصص لمالك البوت فقط!*'
};

let file = import.meta.url;
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    import(`${file}?update=${Date.now()}`);
});
