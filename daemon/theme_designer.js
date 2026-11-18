'use strict';

/**
 * Asks the Antigravity CLI (`agy -p`, using the user's own Antigravity quota/login)
 * to look at a reference image and design a full theme preset, the same way the
 * antigravity-custom-theme skill does by hand. No API key needed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const THEMES_JSON = path.join(ROOT_DIR, 'themes', 'themes.json');

const STR = { type: 'string' };
const BOOL = { type: 'boolean' };
const NUM = { type: 'number' };

const SCHEMA = {
    type: 'object',
    properties: {
        name: STR, concept: STR, primary: STR, secondary: STR, glow: STR, secondaryGlow: STR,
        bg: STR, frameBg: STR, textColor: STR, borderColor: STR, innerBorder: STR,
        overlayRgb: STR, bgPosition: STR,
        sidebarBg: STR, sidebarHoverBg: STR, sidebarEnhanceText: BOOL,
        aiCardBg: STR, aiCardBorder: STR, headerBg: STR, headerBorder: STR,
        btnBg: STR, inputGlassBg: STR, inputCardBg: STR,
        modalBg: STR, modalHeaderBg: STR, cardBg: STR, cardSelectedBg: STR,
        isLight: BOOL, uiTextColor: STR, uiMutedColor: STR,
        pillBg: STR, pillHoverBg: STR, pillTextColor: STR, pillBorder: STR,
        stickerW: NUM, stickerH: NUM, stickerTop: NUM, stickerRight: NUM,
        cornerSvgMarkup: STR, stickerSvgMarkup: STR
    },
    required: [
        'name', 'concept', 'primary', 'secondary', 'glow', 'secondaryGlow', 'bg', 'frameBg', 'textColor',
        'borderColor', 'innerBorder', 'overlayRgb', 'bgPosition', 'sidebarBg', 'sidebarHoverBg',
        'aiCardBg', 'aiCardBorder', 'headerBg', 'headerBorder', 'btnBg', 'inputGlassBg', 'inputCardBg',
        'modalBg', 'modalHeaderBg', 'cardBg', 'cardSelectedBg', 'isLight',
        'cornerSvgMarkup', 'stickerSvgMarkup'
    ]
};

function readExemplar() {
    try {
        const all = JSON.parse(fs.readFileSync(THEMES_JSON, 'utf8'));
        const key = Object.keys(all)[0];
        const t = { ...all[key] };
        delete t.wallpaper;
        const readSvg = (rel) => {
            try { return fs.readFileSync(path.join(ROOT_DIR, 'themes', rel), 'utf8'); } catch (_) { return ''; }
        };
        t.cornerSvgMarkup = readSvg(t.cornerSvg || '');
        t.stickerSvgMarkup = readSvg(t.sticker || '');
        delete t.cornerSvg; delete t.sticker; delete t.isOrnament; delete t.clearBackdrop;
        delete t.unifiedGlass; delete t.sidebarBlur; delete t.headerBlur;
        return { name: key, theme: t };
    } catch (_) {
        return null;
    }
}

function buildPrompt(imageFile) {
    const ex = readExemplar();
    let schemaDoc = '';
    try { schemaDoc = fs.readFileSync(path.join(ROOT_DIR, 'references', 'theme-schema.md'), 'utf8'); } catch (_) {}
    return [
        'You are a UI theme designer for the Antigravity desktop app (glassmorphic wallpaper themes).',
        `Open and carefully LOOK at the reference wallpaper image file named "${imageFile}" in the current directory (use your file-viewing tool; it is the only file you need).`,
        'Do not run shell commands, do not edit or create any files, do not touch anything else. Your ONLY output is the final JSON object that matches the provided JSON schema.',
        '',
        'Design one complete, cohesive theme preset for this specific image, with the same quality and care as the hand-made reference preset below:',
        '- Extract the real dominant and accent colors of THIS image for primary/secondary/overlayRgb and every glass tint; keep all text razor-readable (WCAG-level contrast). Dark image -> dark glass; bright/pastel image -> set isLight true with dark ink (uiTextColor, uiMutedColor, pillTextColor) and frosted light surfaces.',
        '- Tune glass alphas like the reference (sidebar/header very translucent ~0.2-0.3, AI cards ~0.72, modal ~0.96).',
        '- Choose bgPosition so the focal point of the image stays visible.',
        '- Design TWO bespoke SVG ornaments themed on what is actually in the image (subject, motifs, mood), using the palette colors: cornerSvgMarkup (viewBox 0 0 44 44, a corner flourish in the top-left, 1-3 elements) and stickerSvgMarkup (viewBox 0 0 128 38, a small decorative strip that sits above the chat composer). Raw inline SVG markup only: <svg xmlns="http://www.w3.org/2000/svg" ...>. No <script>, no event handlers, no external references, no <image>, no <foreignObject>. Use unique gradient ids.',
        '- stickerW 96, stickerH 30, stickerTop -15, stickerRight 14 unless the design needs otherwise.',
        '- name: a short evocative 2-3 word title for the preset (max 24 chars).',
        '- Colors must be valid CSS (hex or rgba()). overlayRgb is "R, G, B".',
        '',
        'Theme schema reference:',
        schemaDoc,
        '',
        ex ? `Hand-made reference preset "${ex.name}" (for the same black-sun/orbit wallpaper). Match its level of polish, not its colors:` : '',
        ex ? JSON.stringify(ex.theme, null, 2) : ''
    ].join('\n');
}

function findAgy() {
    if (process.env.AGY_BIN && fs.existsSync(process.env.AGY_BIN)) return process.env.AGY_BIN;
    const candidates = [];
    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        candidates.push(path.join(local, 'agy', 'bin', 'agy.exe'));
    } else {
        candidates.push(path.join(os.homedir(), '.local', 'bin', 'agy'), '/usr/local/bin/agy', '/opt/homebrew/bin/agy');
    }
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return 'agy'; // fall back to PATH
}

const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * @param {string} dataUrl  data:image/...;base64,... (downscaled reference image)
 * @param {{timeoutMs?: number, log?: Function}} opts
 * @returns {Promise<object>} designed theme object (raw model output, caller must sanitize)
 */
function designTheme(dataUrl, opts = {}) {
    const timeoutMs = opts.timeoutMs || 240000;
    const log = opts.log || (() => {});
    return new Promise((resolve, reject) => {
        const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
        if (!m) return reject(new Error('Invalid reference image'));
        const ext = MIME_EXT[m[1].toLowerCase()] || 'jpg';
        const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-theme-'));
        const imageFile = `reference.${ext}`;
        const schemaFile = path.join(jobDir, 'schema.json');
        fs.writeFileSync(path.join(jobDir, imageFile), Buffer.from(m[2], 'base64'));
        fs.writeFileSync(schemaFile, JSON.stringify(SCHEMA));
        const cleanup = () => { try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch (_) {} };

        const args = ['-p', buildPrompt(imageFile), '--output-format', 'json', '--json-schema', schemaFile, '--disable-slash-commands', '--add-dir', jobDir];
        if (process.env.AGY_THEME_MODEL) args.push('--model', process.env.AGY_THEME_MODEL);
        const bin = findAgy();
        log(`Designing theme via ${bin} (job ${jobDir})`);
        const child = spawn(bin, args, { cwd: jobDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        const timer = setTimeout(() => { try { child.kill(); } catch (_) {} }, timeoutMs);
        child.on('error', (e) => { clearTimeout(timer); cleanup(); reject(new Error(`Cannot run agy: ${e.message}`)); });
        child.on('close', (code) => {
            clearTimeout(timer);
            cleanup();
            let env;
            try { env = JSON.parse(out.trim().split(/\r?\n/).filter(Boolean).pop()); } catch (_) {}
            if (!env) return reject(new Error(`agy gave no result (exit ${code}). ${err.trim().slice(-300)}`));
            if (env.status !== 'SUCCESS') return reject(new Error(env.error || `agy status ${env.status}`));
            let theme = env.structured_output;
            if (!theme) { try { theme = JSON.parse(env.response); } catch (_) {} }
            if (!theme || typeof theme !== 'object') return reject(new Error('agy returned no structured theme'));
            log(`Theme designed in ${env.duration_seconds}s`);
            resolve(theme);
        });
    });
}

module.exports = { designTheme, SCHEMA };

if (require.main === module) {
    const file = process.argv[2];
    const buf = fs.readFileSync(file);
    const mime = /png$/i.test(file) ? 'image/png' : 'image/jpeg';
    designTheme(`data:${mime};base64,${buf.toString('base64')}`, { log: console.error })
        .then((t) => console.log(JSON.stringify(t, null, 2)))
        .catch((e) => { console.error(e.message); process.exit(1); });
}
