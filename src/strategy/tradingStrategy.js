import logger from '../utils/logger.js';

/**
 * Trading Strategy - Handles signal processing and trade execution logic
 */
class TradingStrategy {
    constructor(binanceTrader, config) {
        this.trader = binanceTrader;
        this.config = config;

        // Risk management
        this.minBalance = parseFloat(config.MIN_BALANCE || 1.0);
        this.maxOpenPositions = parseInt(config.MAX_OPEN_POSITIONS || 1);
        this.slPercentage = parseFloat(config.SL_PERCENTAGE || 0.07);
        this.tp1Roi = parseFloat(config.TP1_ROI || 0.5);
        this.tp2Roi = parseFloat(config.TP2_ROI || 2.0);
        this.minRiskReward = parseFloat(config.MIN_RISK_REWARD || 1.5);

        // Filters
        this.enableRiskRewardFilter = config.ENABLE_RISK_REWARD_FILTER === 'true';
        this.enableVolatilityFilter = config.ENABLE_VOLATILITY_FILTER === 'true';

        // State
        this.activeSignals = new Map();
    }

    /**
     * Handle incoming signal
     */
    async handleSignal(signal) {
        try {
            logger.info(`Processing signal for ${signal.coin} (${signal.direction})`);

            // Validate symbol
            const isValid = await this.trader.validateSymbol(signal.coin);
            if (!isValid) {
                logger.warn(`Invalid symbol: ${signal.coin}`);
                return false;
            }

            // Check if we already have a position
            const hasPosition = await this.trader.hasSymbolPosition(signal.coin);
            if (hasPosition) {
                logger.info(`Already have position for ${signal.coin}. Skipping.`);
                return false;
            }

            // Check position limits
            const openPositionsCount = await this.trader.getOpenPositionsCount();
            if (openPositionsCount >= this.maxOpenPositions) {
                logger.info(`Max open positions reached (${openPositionsCount}/${this.maxOpenPositions}). Skipping.`);
                return false;
            }

            // Check balance
            const balance = await this.trader.getAccountBalance();
            if (balance < this.minBalance) {
                logger.warn(`Insufficient balance: ${balance} USDT (min: ${this.minBalance})`);
                return false;
            }

            // Execute trade based on signal type
            if (signal.entryPrices.length > 0) {
                // Limit order entry
                return await this.executeLimitEntry(signal);
            } else {
                // Market order entry (old format)
                return await this.executeMarketEntry(signal);
            }

        } catch (error) {
            logger.error(`Error handling signal for ${signal.coin}: ${error.message}`, error);
            return false;
        }
    }

    /**
     * Execute limit order entry
     */
    async executeLimitEntry(signal) {
        try {
            const { coin, direction, entryPrices, leverage } = signal;
            const entryPrice = entryPrices[0];

            // Parse leverage
            const leverageValue = parseInt(leverage.replace('X', ''));
            const finalLeverage = Math.min(leverageValue, this.trader.maxLeverage);

            // Set leverage and margin type
            await this.trader.setLeverage(coin, finalLeverage);
            await this.trader.setMarginType(coin, 'ISOLATED');

            // Calculate position size
            const quantity = await this.trader.calculatePositionSize(coin, entryPrice, finalLeverage);
            if (quantity === 0) {
                logger.error(`Invalid quantity calculated for ${coin}`);
                return false;
            }

            // Calculate TP and SL prices
            let tp1Price, tp2Price, finalSlPrice;
            if (signal.type === 'SWING') {
                finalSlPrice = signal.slPrice;
            } else {
                const tpsl = this.calculateTPSL(
                    entryPrice,
                    direction,
                    finalLeverage
                );
                tp1Price = tpsl.tp1Price;
                tp2Price = tpsl.tp2Price;
                finalSlPrice = tpsl.slPrice;
            }

            // Validate risk:reward ratio
            if (this.enableRiskRewardFilter) {
                const firstTpPrice = signal.type === 'SWING' ? signal.targets[0] : tp1Price;
                const riskReward = this.calculateRiskReward(entryPrice, firstTpPrice, finalSlPrice, direction);
                if (riskReward < this.minRiskReward) {
                    logger.warn(`Risk:Reward ratio too low: ${riskReward.toFixed(2)} (min: ${this.minRiskReward})`);
                    return false;
                }
                logger.info(`Risk:Reward ratio: ${riskReward.toFixed(2)}`);
            }

            // Determine order side
            const entrySide = direction === 'LONG' ? 'BUY' : 'SELL';
            const exitSide = direction === 'LONG' ? 'SELL' : 'BUY';

            // Place limit entry order
            const entryOrder = await this.trader.placeLimitOrder(
                coin,
                entrySide,
                quantity,
                entryPrice.toFixed(8)
            );

            logger.info(`✅ Limit entry order placed for ${coin}`);
            if (signal.type === 'SWING') {
                logger.info(`Entry: ${entryPrice}, Targets: ${signal.targets.length}, SL: ${finalSlPrice}`);
            } else {
                logger.info(`Entry: ${entryPrice}, TP1: ${tp1Price}, TP2: ${tp2Price}, SL: ${finalSlPrice}`);
            }

            // Store signal for monitoring
            this.activeSignals.set(coin, {
                signal,
                entryOrderId: entryOrder.orderId,
                quantity,
                entryPrice,
                tp1Price,
                tp2Price,
                slPrice: finalSlPrice,
                exitSide,
                leverage: finalLeverage
            });

            // Start monitoring this order
            this.monitorLimitOrder(coin);

            return true;

        } catch (error) {
            logger.error(`Error executing limit entry for ${signal.coin}: ${error.message}`, error);
            return false;
        }
    }

    /**
     * Execute market order entry (old format)
     */
    async executeMarketEntry(signal) {
        logger.info(`Market order execution not yet implemented for ${signal.coin}`);
        return false;
    }

    /**
     * Calculate TP and SL prices
     */
    calculateTPSL(entryPrice, direction, leverage) {
        // Calculate TP prices based on ROI
        const tp1PriceChange = (entryPrice * this.tp1Roi / 100) / leverage;
        const tp2PriceChange = (entryPrice * this.tp2Roi / 100) / leverage;

        // Calculate SL price based on percentage
        const slPriceChange = entryPrice * this.slPercentage;

        let tp1Price, tp2Price, slPrice;

        if (direction === 'LONG') {
            tp1Price = entryPrice + tp1PriceChange;
            tp2Price = entryPrice + tp2PriceChange;
            slPrice = entryPrice - slPriceChange;
        } else {
            tp1Price = entryPrice - tp1PriceChange;
            tp2Price = entryPrice - tp2PriceChange;
            slPrice = entryPrice + slPriceChange;
        }

        return {
            tp1Price: parseFloat(tp1Price.toFixed(8)),
            tp2Price: parseFloat(tp2Price.toFixed(8)),
            slPrice: parseFloat(slPrice.toFixed(8))
        };
    }

    /**
     * Calculate risk:reward ratio
     */
    calculateRiskReward(entryPrice, tpPrice, slPrice, direction) {
        let risk, reward;

        if (direction === 'LONG') {
            risk = entryPrice - slPrice;
            reward = tpPrice - entryPrice;
        } else {
            risk = slPrice - entryPrice;
            reward = entryPrice - tpPrice;
        }

        return reward / risk;
    }

    /**
     * Monitor limit order for fills
     */
    async monitorLimitOrder(symbol) {
        const checkInterval = 10000; // Check every 10 seconds
        const maxWaitTime = 3600000; // 1 hour timeout

        const startTime = Date.now();

        const intervalId = setInterval(async () => {
            try {
                const signalData = this.activeSignals.get(symbol);
                if (!signalData) {
                    clearInterval(intervalId);
                    return;
                }

                // Check if order is filled
                const hasPosition = await this.trader.hasSymbolPosition(symbol);

                if (hasPosition) {
                    logger.info(`✅ Limit order filled for ${symbol}! Placing TP/SL orders...`);
                    clearInterval(intervalId);

                    // Place protective orders
                    await this.placeProtectiveOrders(symbol, signalData);

                    return;
                }

                // Check timeout
                if (Date.now() - startTime > maxWaitTime) {
                    logger.warn(`Limit order timeout for ${symbol}. Canceling...`);
                    clearInterval(intervalId);

                    await this.trader.cancelOrder(symbol, signalData.entryOrderId);
                    this.activeSignals.delete(symbol);
                }

            } catch (error) {
                logger.error(`Error monitoring limit order for ${symbol}: ${error.message}`, error);
            }
        }, checkInterval);
    }

    /**
     * Place protective TP/SL orders after entry is filled
     */
    async placeProtectiveOrders(symbol, signalData) {
        try {
            const { quantity, tp1Price, tp2Price, slPrice, exitSide, signal } = signalData;
            signalData.tpOrderIds = [];

            if (signal.type === 'SWING' && signal.targets && signal.targets.length > 0) {
                const numTargets = signal.targets.length;
                
                // Get precision from trader to properly split quantity
                const exchangeInfo = await this.trader.monitoringClient.futuresExchangeInfo();
                const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
                const stepSize = parseFloat(symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE').stepSize);
                const precision = stepSize.toString().split('.')[1]?.length || 0;
                
                let remainingQuantity = quantity;
                const baseQuantityPerTarget = parseFloat((quantity / numTargets).toFixed(precision));

                for (let i = 0; i < numTargets; i++) {
                    const targetPrice = signal.targets[i];
                    // Ensure the last target takes the exact remaining quantity to avoid leaving dust
                    const qty = i === numTargets - 1 ? parseFloat(remainingQuantity.toFixed(precision)) : baseQuantityPerTarget;
                    remainingQuantity -= qty;

                    const tpOrder = await this.trader.placeTakeProfit(
                        symbol,
                        exitSide,
                        qty,
                        targetPrice.toFixed(8)
                    );
                    signalData.tpOrderIds.push(tpOrder.orderId);
                }
            } else {
                // Split quantity for TP1 and TP2 (50% each)
                const tp1Quantity = (quantity * 0.5).toFixed(8);
                const tp2Quantity = (quantity * 0.5).toFixed(8);

                // Place TP1 order
                const tp1Order = await this.trader.placeTakeProfit(
                    symbol,
                    exitSide,
                    tp1Quantity,
                    tp1Price.toFixed(8)
                );
                signalData.tpOrderIds.push(tp1Order.orderId);

                // Place TP2 order
                const tp2Order = await this.trader.placeTakeProfit(
                    symbol,
                    exitSide,
                    tp2Quantity,
                    tp2Price.toFixed(8)
                );
                signalData.tpOrderIds.push(tp2Order.orderId);
            }

            // Place SL order
            const slOrder = await this.trader.placeStopLoss(
                symbol,
                exitSide,
                quantity,
                slPrice.toFixed(8)
            );
            signalData.slOrderId = slOrder.orderId;

            logger.info(`✅ Protective orders placed for ${symbol}`);
            logger.info(`TP Orders: ${signalData.tpOrderIds.join(', ')}, SL: ${slOrder.orderId}`);

            // Start TP monitoring for Swing trades to move SL to entry when TP3 is hit
            if (signal.type === 'SWING' && signal.targets && signal.targets.length >= 3) {
                this.monitorTakeProfits(symbol);
            }

        } catch (error) {
            logger.error(`Error placing protective orders for ${symbol}: ${error.message}`, error);
        }
    }

    /**
     * Monitor TP orders for SWING trades to move SL to entry
     */
    async monitorTakeProfits(symbol) {
        const checkInterval = 15000; // Check every 15 seconds
        
        const intervalId = setInterval(async () => {
            try {
                const signalData = this.activeSignals.get(symbol);
                if (!signalData) {
                    clearInterval(intervalId);
                    return;
                }

                // Check if position is already closed entirely
                const hasPosition = await this.trader.hasSymbolPosition(symbol);
                if (!hasPosition) {
                    logger.info(`Position for ${symbol} closed. Stopping TP monitor.`);
                    clearInterval(intervalId);
                    this.activeSignals.delete(symbol);
                    return;
                }

                // Get open orders to check which TP orders are still active
                const openOrders = await this.trader.getOpenOrders(symbol);
                const openOrderIds = openOrders.map(o => o.orderId);
                
                let filledTpCount = 0;
                for (const tpOrderId of signalData.tpOrderIds) {
                    if (!openOrderIds.includes(tpOrderId)) {
                        filledTpCount++;
                    }
                }

                // If 3 or more TPs are filled and SL hasn't been moved yet
                if (filledTpCount >= 3 && !signalData.slMovedToEntry) {
                    logger.info(`🎯 TP3 reached for ${symbol}! Moving Stop Loss to Entry Price (${signalData.entryPrice}).`);
                    
                    // Cancel old SL
                    if (signalData.slOrderId) {
                        await this.trader.cancelOrder(symbol, signalData.slOrderId);
                    }

                    // Get current position size to place new SL for the remaining amount
                    const positions = await this.trader.monitoringClient.futuresPositionRisk();
                    const position = positions.find(pos => pos.symbol === symbol && parseFloat(pos.positionAmt) !== 0);
                    
                    if (position) {
                        const remainingQty = Math.abs(parseFloat(position.positionAmt));
                        
                        // Place new SL at entry price
                        const newSlOrder = await this.trader.placeStopLoss(
                            symbol,
                            signalData.exitSide,
                            remainingQty,
                            signalData.entryPrice.toFixed(8)
                        );
                        
                        signalData.slOrderId = newSlOrder.orderId;
                        signalData.slMovedToEntry = true;
                        logger.info(`✅ Stop Loss for ${symbol} successfully moved to entry price.`);
                    }
                    
                    // We can stop monitoring if SL is moved and we don't have other dynamic actions
                    clearInterval(intervalId);
                }

            } catch (error) {
                logger.error(`Error monitoring TPs for ${symbol}: ${error.message}`, error);
            }
        }, checkInterval);
    }

    /**
     * Handle opposite direction signal (close existing position)
     */
    async handleOppositeDirection(signal) {
        try {
            logger.info(`Handling opposite direction signal for ${signal.coin}`);

            // Cancel all orders for this symbol
            await this.trader.cancelAllOrders(signal.coin);

            // Remove from active signals
            this.activeSignals.delete(signal.coin);

            logger.info(`Canceled all orders for ${signal.coin} due to opposite direction signal`);
            return true;

        } catch (error) {
            logger.error(`Error handling opposite direction for ${signal.coin}: ${error.message}`, error);
            return false;
        }
    }
}

export default TradingStrategy;
