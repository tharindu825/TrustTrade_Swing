import logger from '../utils/logger.js';

/**
 * Signal Parser - Parses Telegram messages to extract trading signals
 */
class TelegramSignalParser {
    constructor() {
        // Patterns for the new signal format: 🔥#BEAT/USDT (Short📉, x20)🔥
        this.newPatterns = {
            signalHeader: /#([A-Z0-9]+)\/USDT\s*\(\s*(Long|Short)[^,]*,\s*x(\d+)\s*\)/i,
            entryPrice: /Entry\s*-\s*([0-9.]+)/i,
            tpLevels: /([0-9.]+)\s*\(\d+%\s*of\s*profit\)/gi,
            tpPrice: /Price\s*-\s*([0-9.]+)/i,
            tpProfit: /Profit\s*-\s*(\d+)%/i
        };

        // Patterns for the old signal format (backward compatibility)
        this.oldPatterns = {
            coin: /Coin pair:\s*([A-Z0-9]+)/i,
            direction: /Order:\s*(buy|sell)/i
        };

        // Patterns for the Swing trade signal format
        this.swingPatterns = {
            signalId: /SIGNAL ID:\s*#([A-Z0-9]+)/i,
            coin: /COIN:\s*\$([A-Z0-9]+)\/USDT/i,
            direction: /Direction:\s*(LONG|SHORT)/i,
            type: /Type:\s*(Swing)/i,
            leverage: /Leverage:\s*(\d+)-?(\d*)x/i,
            entryPrice: /ENTRY:\s*([0-9.]+)\s*-\s*([0-9.]+)/i,
            targetLevels: /Target\s*\d+:\s*([0-9.]+)/gi,
            stopLoss: /STOP LOSS:\s*([0-9.]+)/i
        };
    }

    /**
     * Normalize text by removing emojis and special characters
     */
    _normalizeText(text) {
        const replacements = {
            '📌': '', '⭕️': '', '📈': '', '📉': '', '✴️': '', '⚠️': '',
            '🟢': '', '🔴': '', '⭐': '', '🚀': '', '💠': '',
            '🇱🇰': '', '🔥': '', '🔔': '', '✅': '', '⏰': '', '⚠': '',
            '📍': '', '⬆️': '', '⬇️': '', '🔘': '', '🚫': ''
        };

        let normalized = text;
        for (const [emoji, replacement] of Object.entries(replacements)) {
            normalized = normalized.replace(new RegExp(emoji, 'g'), replacement);
        }

        // Remove any remaining non-ASCII characters
        normalized = normalized.replace(/[^\x00-\x7F]+/g, ' ');
        return normalized;
    }

    /**
     * Parse Telegram message to extract trading signal
     */
    parseMessage(text, timestamp = Date.now()) {
        try {
            const normalizedText = this._normalizeText(text);
            logger.info(`Parsing normalized message: ${normalizedText.substring(0, 200)}...`);

            // Try to parse Swing signal format first
            const swingCoinMatch = normalizedText.match(this.swingPatterns.coin);
            const swingDirMatch = normalizedText.match(this.swingPatterns.direction);
            const swingTypeMatch = normalizedText.match(this.swingPatterns.type);

            if (swingCoinMatch && swingDirMatch && swingTypeMatch) {
                const coinName = swingCoinMatch[1].toUpperCase();
                const coin = `${coinName}USDT`;
                const directionRaw = swingDirMatch[1].toUpperCase();
                const direction = directionRaw === 'LONG' ? 'LONG' : 'SHORT';
                
                // Extract entry range and calculate average
                const entryMatch = normalizedText.match(this.swingPatterns.entryPrice);
                let entryPrice = null;
                if (entryMatch) {
                    const entryLow = parseFloat(entryMatch[1]);
                    const entryHigh = parseFloat(entryMatch[2]);
                    entryPrice = (entryLow + entryHigh) / 2;
                }

                // Extract targets
                const targets = [];
                let match;
                while ((match = this.swingPatterns.targetLevels.exec(normalizedText)) !== null) {
                    targets.push(parseFloat(match[1]));
                }

                // Extract Stop Loss
                const slMatch = normalizedText.match(this.swingPatterns.stopLoss);
                const slPrice = slMatch ? parseFloat(slMatch[1]) : null;

                if (entryPrice && targets.length > 0 && slPrice) {
                    logger.info(`Swing signal detected: Coin=${coin}, Direction=${direction}, Entry=${entryPrice}, Targets=${targets.length}, SL=${slPrice}`);
                    
                    return {
                        coin,
                        direction,
                        entryPrices: [entryPrice],
                        targets,
                        slPrice,
                        leverage: `${process.env.DEFAULT_LEVERAGE || 10}X`, // Use env leverage as requested
                        isTakeProfit: false,
                        profit: 0.0,
                        type: 'SWING',
                        timestamp,
                        message: text
                    };
                } else {
                    logger.warn(`Swing format detected but missing entry, targets, or SL data for ${coin}`);
                    return null;
                }
            }

            // Try to parse new signal format next
            const signalHeaderMatch = normalizedText.match(this.newPatterns.signalHeader);

            if (signalHeaderMatch) {
                const symbolName = signalHeaderMatch[1].toUpperCase();
                const directionStr = signalHeaderMatch[2].toUpperCase();
                const leverageValue = signalHeaderMatch[3];

                const coin = `${symbolName}USDT`;
                const direction = directionStr === 'LONG' ? 'LONG' : 'SHORT';
                const leverage = `${leverageValue}X`;

                // Extract entry price
                const entryMatch = normalizedText.match(this.newPatterns.entryPrice);
                const entryPrice = entryMatch ? parseFloat(entryMatch[1]) : null;

                if (entryPrice) {
                    logger.info(`New signal format detected: Coin=${coin}, Direction=${direction}, Leverage=${leverage}, Entry=${entryPrice}`);

                    return {
                        coin,
                        direction,
                        entryPrices: [entryPrice],
                        targets: [],
                        leverage,
                        isTakeProfit: false,
                        profit: 0.0,
                        timestamp,
                        message: text
                    };
                } else {
                    // Check if this is a TP signal
                    const tpPriceMatch = normalizedText.match(this.newPatterns.tpPrice);
                    const tpProfitMatch = normalizedText.match(this.newPatterns.tpProfit);

                    if (tpPriceMatch && tpProfitMatch) {
                        const tpPrice = parseFloat(tpPriceMatch[1]);
                        const profitPercent = parseFloat(tpProfitMatch[1]);

                        logger.info(`TP signal detected: Coin=${coin}, Price=${tpPrice}, Profit=${profitPercent}%`);

                        return {
                            coin,
                            direction,
                            entryPrices: [],
                            targets: [tpPrice],
                            leverage,
                            isTakeProfit: true,
                            profit: profitPercent,
                            timestamp,
                            message: text
                        };
                    } else {
                        logger.warn(`New format detected but no entry price or TP data found for ${coin}`);
                        return null;
                    }
                }
            }

            // Try old format
            const coinMatch = normalizedText.match(this.oldPatterns.coin);
            const directionMatch = normalizedText.match(this.oldPatterns.direction);

            if (coinMatch && directionMatch) {
                let coinName = coinMatch[1].toUpperCase();
                coinName = coinName.replace('.P', '').replace('.PERP', '');
                const coin = coinName.endsWith('USDT') ? coinName : `${coinName}USDT`;

                const directionRaw = directionMatch[1].toUpperCase();
                const direction = directionRaw === 'BUY' ? 'LONG' : 'SHORT';

                logger.info(`Old signal format detected: Coin=${coin}, Direction=${direction}`);

                return {
                    coin,
                    direction,
                    entryPrices: [],
                    targets: [],
                    leverage: `${process.env.DEFAULT_LEVERAGE || 20}X`,
                    isTakeProfit: false,
                    profit: 0.0,
                    timestamp,
                    message: text
                };
            }

            logger.warn('Message does not match any known signal format');
            return null;

        } catch (error) {
            logger.error(`Parsing error: ${error.message}`, error);
            return null;
        }
    }
}

export default TelegramSignalParser;
