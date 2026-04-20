const text = `
📍 SIGNAL ID: #G97
COIN: $INJ/USDT
Direction: ⬆️ LONG
Type: Swing
--------------------
Position Size: 2-4%
Leverage: 3-5x
--------------------

ENTRY: 3.22 - 3.23

🔘 Target 1: 3.33
🔘 Target 2: 3.41
🔘 Target 3: 3.44
🔘 Target 4: 3.47
🔘 Target 5: 3.64

🚫 STOP LOSS: 3.07

Daily trend remains bullish with EMA ribbon alignment supporting the long bias. The 4H chart shows a weak bullish structure, bouncing off strong support near 3.18 and the lower Bollinger Band, signaling a potential rebound. Entry between 3.22-3.23 is optimal; key level to watch is 3.07 for stop loss validation.
--------------------
Your truly,
Always Win VVIP
`;

const normalizeText = (t) => {
    const replacements = {
        '📌': '', '⭕️': '', '📈': '', '📉': '', '✴️': '', '⚠️': '',
        '🟢': '', '🔴': '', '⭐': '', '🚀': '', '💠': '',
        '🇱🇰': '', '🔥': '', '🔔': '', '✅': '', '⏰': '', '⚠': '',
        '📍': '', '⬆️': '', '⬇️': '', '🔘': '', '🚫': ''
    };
    let normalized = t;
    for (const [emoji, replacement] of Object.entries(replacements)) {
        normalized = normalized.replace(new RegExp(emoji, 'g'), replacement);
    }
    // Remove any remaining non-ASCII characters, BUT maybe leave emojis handled above
    normalized = normalized.replace(/[^\x00-\x7F]+/g, ' ');
    return normalized;
}

const nText = normalizeText(text);
console.log(nText);

// Regexes
const coinPattern = /COIN:\s*\$([A-Z0-9]+)\/USDT/i;
const dirPattern = /Direction:\s*(LONG|SHORT)/i;
const typePattern = /Type:\s*(Swing|Scalp|Intraday)/i;
const levPattern = /Leverage:\s*(\d+)-?(\d*)x/i;
const entryPattern = /ENTRY:\s*([0-9.]+)\s*-\s*([0-9.]+)/i;
const targetPattern = /Target\s*\d+:\s*([0-9.]+)/gi;
const slPattern = /STOP LOSS:\s*([0-9.]+)/i;

console.log("Coin:", nText.match(coinPattern)?.[1]);
console.log("Dir:", nText.match(dirPattern)?.[1]);
console.log("Type:", nText.match(typePattern)?.[1]);
const levMatch = nText.match(levPattern);
if (levMatch) console.log("Leverage:", levMatch[1], levMatch[2]);
console.log("Entry:", nText.match(entryPattern)?.[1], nText.match(entryPattern)?.[2]);

const targets = [];
let match;
while ((match = targetPattern.exec(nText)) !== null) {
    targets.push(parseFloat(match[1]));
}
console.log("Targets:", targets);
console.log("SL:", nText.match(slPattern)?.[1]);
