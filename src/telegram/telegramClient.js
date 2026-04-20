import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import input from 'input';
import logger from '../utils/logger.js';
import TelegramSignalParser from '../parsers/signalParser.js';

/**
 * Telegram Client - Connects to Telegram and listens for signals
 */
class TelegramSignalBot {
    constructor(config, signalHandler) {
        this.apiId = parseInt(config.API_ID);
        this.apiHash = config.API_HASH;
        this.phoneNumber = config.PHONE_NUMBER;
        this.channelId = config.CHANNEL_ID;
        this.signalHandler = signalHandler;

        this.parser = new TelegramSignalParser();
        this.client = null;
        this.session = new StringSession(''); // Empty session for first run
        this.processedSignals = new Map();
        this.deduplicationWindow = parseInt(config.DEDUPLICATION_WINDOW || 600) * 1000; // Convert to ms
    }

    /**
     * Connect to Telegram
     */
    async connect() {
        try {
            logger.info(`Connecting to Telegram with phone: ${this.phoneNumber}`);

            this.client = new TelegramClient(
                this.session,
                this.apiId,
                this.apiHash,
                {
                    connectionRetries: 5,
                }
            );

            await this.client.start({
                phoneNumber: async () => this.phoneNumber,
                password: async () => await input.text('Please enter your password: '),
                phoneCode: async () => await input.text('Please enter the code you received: '),
                onError: (err) => logger.error(`Telegram auth error: ${err.message}`),
            });

            logger.info('Connected to Telegram successfully!');
            logger.info(`Session string: ${this.client.session.save()}`); // Save this for future use

        } catch (error) {
            logger.error(`Failed to connect to Telegram: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * Get channel entity
     */
    async getChannel() {
        try {
            logger.info(`Resolving channel: ${this.channelId}`);

            let channel;
            if (this.channelId.startsWith('@')) {
                // Public channel by username
                channel = await this.client.getEntity(this.channelId);
            } else if (this.channelId.includes(':')) {
                // Channel ID with access hash format: "channelId:accessHash"
                const [channelIdStr, accessHashStr] = this.channelId.split(':');
                const channelId = BigInt(channelIdStr);
                const accessHash = BigInt(accessHashStr);

                // Import Api for InputPeerChannel
                const { Api } = await import('telegram');

                // Create InputPeerChannel
                const inputChannel = new Api.InputPeerChannel({
                    channelId: channelId,
                    accessHash: accessHash
                });

                channel = await this.client.getEntity(inputChannel);
            } else {
                // Plain channel ID (try with -100 prefix for supergroups/channels)
                let channelId = this.channelId;

                // If it doesn't start with -100, add it
                if (!channelId.startsWith('-100')) {
                    channelId = `-100${channelId}`;
                }

                channel = await this.client.getEntity(parseInt(channelId));
            }

            logger.info(`Channel resolved: ${channel.title || 'Unknown'}`);
            return channel;

        } catch (error) {
            logger.error(`Failed to resolve channel: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * Check if signal is duplicate
     */
    isDuplicateSignal(signal) {
        const key = `${signal.coin}_${signal.entryPrices.join('_')}`;
        const now = Date.now();

        if (this.processedSignals.has(key)) {
            const lastTimestamp = this.processedSignals.get(key);
            if (now - lastTimestamp < this.deduplicationWindow) {
                logger.info(`Duplicate signal detected for ${signal.coin}. Skipping.`);
                return true;
            }
        }

        this.processedSignals.set(key, now);

        // Clean up old entries
        for (const [k, timestamp] of this.processedSignals.entries()) {
            if (now - timestamp > this.deduplicationWindow) {
                this.processedSignals.delete(k);
            }
        }

        return false;
    }

    /**
     * Listen to channel for new messages
     */
    async listenToChannel() {
        try {
            const channel = await this.getChannel();
            const channelId = channel.id; // BigInt channel ID for peer filtering

            logger.info(`Listening to channel: ${channel.title || 'Unknown'}...`);

            // Use NewMessage with the numeric channel ID (not the entity object)
            // Passing an entity object directly causes "Cannot find entity [object Object]"
            this.client.addEventHandler(async (event) => {
                try {
                    if (!event.message) return;

                    // Filter: only process messages from our target channel
                    const peerId = event.message.peerId;
                    if (peerId && peerId.channelId && peerId.channelId !== channelId) {
                        return;
                    }

                    const messageText = event.message.message;
                    if (!messageText) return;

                    const messageTimestamp = event.message.date * 1000; // Convert to ms

                    logger.debug(`New message received: ${messageText.substring(0, 100)}...`);

                    // Parse the message
                    const signal = this.parser.parseMessage(messageText, messageTimestamp);

                    if (signal) {
                        // Check for duplicates
                        if (this.isDuplicateSignal(signal)) {
                            return;
                        }

                        logger.info(`Valid signal detected:\n${JSON.stringify(signal, null, 2)}`);

                        // Handle TP signals
                        if (signal.isTakeProfit) {
                            if (signal.message.includes('Closed due to opposite direction')) {
                                logger.info(`Received 'Closed due to opposite direction' signal for ${signal.coin}`);
                                await this.signalHandler(signal);
                            } else {
                                logger.info(`Ignoring TP signal for ${signal.coin} (profit ${signal.profit}%). Bot uses own TP1/TP2 system.`);
                            }
                        } else {
                            // Regular entry signal
                            await this.signalHandler(signal);
                        }
                    }

                } catch (error) {
                    logger.error(`Error processing message: ${error.message}`, error);
                }
            }, new NewMessage({}));

            // gramjs v2 has no .run() or .runUntilDisconnected() — the client runs in the
            // background after .start(). Use a never-resolving promise to keep Node alive.
            logger.info('Event handler registered. Bot is now listening...');
            await new Promise(() => {});

        } catch (error) {
            logger.error(`Error in listenToChannel: ${error.message}`, error);
            // Reconnect after delay
            logger.info('Reconnecting in 10 seconds...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            await this.connect();
            await this.listenToChannel();
        }
    }

    /**
     * Disconnect from Telegram
     */
    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            logger.info('Disconnected from Telegram');
        }
    }
}

export default TelegramSignalBot;
