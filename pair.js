import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import { exec } from 'child_process';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import uploadToPastebin from './Paste.js';

const router = express.Router();

const MESSAGE = `
*SESSION GENERATED SUCCESSFULLY* ✅

*Gɪᴠᴇ ᴀ ꜱᴛᴀʀ ᴛᴏ ʀᴇᴘᴏ ꜰᴏʀ ᴄᴏᴜʀᴀɢᴇ* 🌟
https://github.com/GlobalTechInfo/MEGA-MD

*Sᴜᴘᴘᴏʀᴛ Gʀᴏᴜᴘ ꜰᴏʀ ϙᴜᴇʀʏ* 💭
https://t.me/Global_TechInfo
https://whatsapp.com/channel/0029VagJIAr3bbVBCpEkAM07

*Yᴏᴜ-ᴛᴜʙᴇ ᴛᴜᴛᴏʀɪᴀʟꜱ* 🪄 
https://youtube.com/@GlobalTechInfo

*MEGA-MD--WHATSAPP* 🥀
`;
async function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        await fs.remove(FilePath);
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

router.get('/', async (req, res) => {
    let num = req.query.number;
    const dirs = './auth_info_baileys';

    await removeFile(dirs);

    // Validate phone number
    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number. Use full international format without + or spaces.' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    async function initiateSession() {
        try {
            const { state, saveCreds } = await useMultiFileAuthState(dirs);
            const { version } = await fetchLatestBaileysVersion();

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.windows('Chrome'),
                markOnlineOnConnect: false,
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    try {
                        const credsFile = dirs + '/creds.json';
                        if (fs.existsSync(credsFile)) {
                            const pastebinUrl = await uploadToPastebin(credsFile, 'creds.json', 'json', '1');
                            console.log('📄 Session uploaded to Pastebin:', pastebinUrl);

                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            const msg = await sock.sendMessage(userJid, { text: `📄 Your session ID: ${pastebinUrl}` });
                            await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });

                            await delay(1000);
                            await removeFile(dirs);
                        }
                    } catch (err) {
                        console.error('Error sending session:', err);
                        await removeFile(dirs);
                    }
                }

                if (isNewLogin) console.log('🔐 New login via pair code');

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) console.log('❌ Logged out - generate new pair code');
                    else {
                        console.log('🔁 Connection closed — restarting...');
                        initiateSession();
                    }
                }
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                try {
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    if (!res.headersSent) await res.send({ code });
                    console.log('📱 Pairing code sent:', code);
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    if (!res.headersSent) res.status(503).send({ code: 'Failed to get pairing code' });
                }
            }

            sock.ev.on('creds.update', saveCreds);
        } catch (err) {
            console.error('❌ Error initializing session:', err);
            await removeFile(dirs);
            exec('pm2 restart qasim');
            if (!res.headersSent) res.status(503).send({ code: 'Service Unavailable' });
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    const ignore = [
        "conflict", "not-authorized", "Socket connection timeout",
        "rate-overlimit", "Connection Closed", "Timed Out",
        "Value not found", "Stream Errored", "Stream Errored (restart required)",
        "statusCode: 515", "statusCode: 503"
    ];
    if (!ignore.some(x => e.includes(x))) {
        console.log('Caught exception:', err);
        exec('pm2 restart qasim');
    }
});

export default router;
