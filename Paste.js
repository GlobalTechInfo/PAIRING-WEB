import fs from 'fs';

const PASTEBIN_API_KEY = process.env.PASTEBIN_API_KEY || '';

function readContent(input) {
    if (Buffer.isBuffer(input)) return input.toString();
    if (typeof input !== 'string') throw new Error('Unsupported input type.');
    if (input.startsWith('data:')) return Buffer.from(input.split(',')[1], 'base64').toString();
    if (input.startsWith('http://') || input.startsWith('https://')) return input;
    if (fs.existsSync(input)) return fs.readFileSync(input, 'utf8');
    return input;
}

async function uploadViaPastebin(content, title, format, privacy) {
    const privacyMap = { '0': 0, '1': 1, '2': 2 };
    const body = new URLSearchParams({
        api_dev_key: PASTEBIN_API_KEY,
        api_option: 'paste',
        api_paste_code: content,
        api_paste_name: title,
        api_paste_format: format,
        api_paste_private: String(privacyMap[privacy] ?? 1),
        api_paste_expire_date: 'N',
    });

    const res = await fetch('https://pastebin.com/api/api_post.php', {
        method: 'POST',
        body,
    });

    const text = await res.text();
    if (!text.startsWith('https://')) throw new Error(`Pastebin error: ${text}`);
    return text.trim();
}

async function uploadViaPasteRs(content) {
    const res = await fetch('https://paste.rs/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: content,
    });

    if (!res.ok) throw new Error(`paste.rs error: ${res.status}`);
    return (await res.text()).trim();
}

async function uploadToPastebin(input, title = 'Untitled', format = 'json', privacy = '1') {
    try {
        const content = readContent(input);
        let pasteUrl;

        if (PASTEBIN_API_KEY) {
            pasteUrl = await uploadViaPastebin(content, title, format, privacy);
        } else {
            console.log('⚠️ No PASTEBIN_API_KEY set, using paste.rs as fallback');
            pasteUrl = await uploadViaPasteRs(content);
        }

        const pasteId = pasteUrl.replace(/https?:\/\/[^/]+\//, '');
        const customUrl = `GlobalTechInfo/MEGA-MD_${pasteId}`;

        console.log('✅ Session paste URL:', customUrl);
        return customUrl;
    } catch (error) {
        console.error('Error uploading paste:', error);
        throw error;
    }
}

export default uploadToPastebin;
