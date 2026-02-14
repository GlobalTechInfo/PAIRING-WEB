import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import pn from 'awesome-phonenumber';
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason
} from '@whiskeysockets/baileys';
import uploadToPastebin from './Paste.js';

const router = express.Router();
const MAX_RECONNECT_ATTEMPTS = 3;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const CLEANUP_DELAY = 5000;

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

    if (!num) {
        return res.status(400).send({ code: 'Phone number is required' });
    }

    num = num.replace(/[^0-9]/g, '');
    const phone = pn('+' + num);

    if (!phone.isValid()) {
        return res.status(400).send({ code: 'Invalid phone number. Use full international format without + or spaces.' });
    }

    num = phone.getNumber('e164').replace('+', '');

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const dirs = `./auth_info_baileys/session_${sessionId}`;

    let pairingCodeSent = false;
    let sessionCompleted = false;
    let isCleaningUp = false;
    let responseSent = false;
    let reconnectAttempts = 0;
    let currentSocket = null;
    let timeoutHandle = null;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;

        console.log(`🧹 Cleaning up session ${sessionId} (${num}) - Reason: ${reason}`);

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }

        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {
                console.error('Error closing socket:', e);
            }
            currentSocket = null;
        }

        setTimeout(async () => {
            await removeFile(dirs);
        }, CLEANUP_DELAY);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) {
            console.log('⚠️ Session already completed or cleaning up');
            return;
        }

        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.log(`❌ Max reconnection attempts reached for ${num}`);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: 'Connection failed after multiple attempts' });
            }
            await cleanup('max_reconnects');
            return;
        }

        try {
            if (!fs.existsSync(dirs)) {
                await fs.mkdir(dirs, { recursive: true });
            }

            const { state, saveCreds } = await useMultiFileAuthState(dirs);
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            currentSocket = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 3,
            });

            const sock = currentSocket;

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;

                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    if (sessionCompleted) {
                        console.log('⚠️ Session already completed, skipping...');
                        return;
                    }
                    sessionCompleted = true;

                    try {
                        const credsFile = `${dirs}/creds.json`;
                        if (fs.existsSync(credsFile)) {
                            console.log(`📄 Uploading creds.json for ${num} to Pastebin...`);
                            const pastebinUrl = await uploadToPastebin(credsFile, 'creds.json', 'json', '1');
                            console.log('✅ Session uploaded to Pastebin:', pastebinUrl);

                            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
                            const msg = await sock.sendMessage(userJid, { text: pastebinUrl });
                            await sock.sendMessage(userJid, { text: MESSAGE, quoted: msg });

                            await delay(1000);
                        }
                    } catch (err) {
                        console.error('Error sending session:', err);
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (isNewLogin) {
                    console.log(`🔐 New login via pair code for ${num}`);
                }

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        console.log('✅ Session completed, not reconnecting');
                        await cleanup('already_complete');
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const reason = lastDisconnect?.error?.output?.payload?.error;

                    console.log(`❌ Connection closed - Status: ${statusCode}, Reason: ${reason}`);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        console.log(`❌ Logged out or invalid pairing for ${num}`);
                        if (!responseSent && !res.headersSent) {
                            responseSent = true;
                            res.status(401).send({ code: 'Invalid pairing code or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (pairingCodeSent && !sessionCompleted) {
                        reconnectAttempts++;
                        console.log(`🔁 Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} for ${num}`);
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            if (!sock.authState.creds.registered && !pairingCodeSent && !isCleaningUp) {
                await delay(1500);
                try {
                    pairingCodeSent = true;
                    let code = await sock.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.send({ code });
                        console.log(`📱 Pairing code sent for ${num}: ${code}`);
                    }
                } catch (error) {
                    console.error('❌ Error requesting pairing code:', error);
                    pairingCodeSent = false;
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(503).send({ code: 'Failed to get pairing code' });
                    }
                    await cleanup('pairing_code_error');
                }
            }

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted && !isCleaningUp) {
                    console.log(`⏰ Pairing timeout for ${num}`);
                    if (!responseSent && !res.headersSent) {
                        responseSent = true;
                        res.status(408).send({ code: 'Pairing timeout' });
                    }
                    await cleanup('timeout');
                }
            }, SESSION_TIMEOUT);

        } catch (err) {
            console.error(`❌ Error initializing session for ${num}:`, err);
            if (!responseSent && !res.headersSent) {
                responseSent = true;
                res.status(503).send({ code: 'Service Unavailable' });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

setInterval(async () => {
    try {
        const baseDir = './auth_info_baileys';
        if (!fs.existsSync(baseDir)) return;

        const sessions = await fs.readdir(baseDir);
        const now = Date.now();

        for (const session of sessions) {
            const sessionPath = `${baseDir}/${session}`;
            try {
                const stats = await fs.stat(sessionPath);
                if (now - stats.mtimeMs > 10 * 60 * 1000) {
                    console.log(`🗑️ Removing old session: ${session}`);
                    await fs.remove(sessionPath);
                }
            } catch (e) {}
        }
    } catch (e) {
        console.error('Error in cleanup interval:', e);
    }
}, 60000);

process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received, cleaning up...');
    try { await fs.remove('./auth_info_baileys'); } catch (e) {}
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received, cleaning up...');
    try { await fs.remove('./auth_info_baileys'); } catch (e) {}
    process.exit(0);
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
    }
});

export default router;
