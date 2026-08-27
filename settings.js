import fs from 'fs';
import chalk from 'chalk';

global.owner = ['967717521122']; // رقمك
global.premium = ['967717521122'];
global.botname = 'ALI-MD';
global.packname = 'ALI-MD';
global.author = 'ALI';
global.menuType = 'v1';
global.prefix = '.';

let file = import.meta.url;
fs.watchFile(file, () => {
	fs.unwatchFile(file);
	console.log(chalk.redBright(`Update '${file}'`));
	import(`${file}?update=${Date.now()}`);
});
