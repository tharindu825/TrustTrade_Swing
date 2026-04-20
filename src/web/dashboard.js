import express from 'express';
import logger from '../utils/logger.js';

/**
 * Web Dashboard - Simple monitoring interface
 */
class WebDashboard {
    constructor(trader, config) {
        this.trader = trader;
        this.port = parseInt(config.WEB_PORT || 5000);
        this.app = express();
        this.server = null;
    }

    /**
     * Start web server
     */
    start() {
        // Home page - Dashboard
        this.app.get('/', (req, res) => {
            const html = this.generateDashboardHTML();
            res.send(html);
        });

        // API endpoint for positions
        this.app.get('/api/positions', async (req, res) => {
            try {
                const positions = await this.trader.monitoringClient.futuresPositionRisk();
                const openPositions = positions
                    .filter(pos => parseFloat(pos.positionAmt) !== 0)
                    .map(pos => ({
                        symbol: pos.symbol,
                        positionAmt: pos.positionAmt,
                        entryPrice: pos.entryPrice,
                        markPrice: pos.markPrice,
                        unrealizedProfit: pos.unRealizedProfit,
                        leverage: pos.leverage
                    }));

                res.json({ positions: openPositions });
            } catch (error) {
                logger.error(`Error fetching positions: ${error.message}`);
                res.status(500).json({ error: error.message });
            }
        });

        // API endpoint for open orders
        this.app.get('/api/orders', async (req, res) => {
            try {
                const orders = await this.trader.monitoringClient.futuresOpenOrders();
                res.json({ orders });
            } catch (error) {
                logger.error(`Error fetching orders: ${error.message}`);
                res.status(500).json({ error: error.message });
            }
        });

        // API endpoint for account info
        this.app.get('/api/account', async (req, res) => {
            try {
                const balance = await this.trader.getAccountBalance();
                res.json({ balance });
            } catch (error) {
                logger.error(`Error fetching account info: ${error.message}`);
                res.status(500).json({ error: error.message });
            }
        });

        // Start server
        this.server = this.app.listen(this.port, '0.0.0.0', () => {
            logger.info(`Web dashboard started at http://0.0.0.0:${this.port}`);
        });
    }

    /**
     * Generate dashboard HTML
     */
    generateDashboardHTML() {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="refresh" content="10">
    <title>TrustTrade Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        
        h1 {
            color: white;
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .card {
            background: white;
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        }
        
        h2 {
            color: #667eea;
            margin-bottom: 20px;
            font-size: 1.8em;
            border-bottom: 3px solid #667eea;
            padding-bottom: 10px;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
        }
        
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
        }
        
        th {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.9em;
            letter-spacing: 0.5px;
        }
        
        tr:hover {
            background-color: #f5f5f5;
        }
        
        .no-data {
            text-align: center;
            color: #999;
            font-style: italic;
            padding: 30px;
        }
        
        .positive {
            color: #10b981;
            font-weight: bold;
        }
        
        .negative {
            color: #ef4444;
            font-weight: bold;
        }
        
        .status {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 600;
        }
        
        .status.active {
            background: #10b981;
            color: white;
        }
        
        .refresh-info {
            text-align: center;
            color: white;
            margin-top: 20px;
            font-size: 0.9em;
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        
        .stat-box {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }
        
        .stat-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }
        
        .stat-label {
            font-size: 0.9em;
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 TrustTrade Dashboard</h1>
        
        <div class="card">
            <div class="stats" id="stats">
                <div class="stat-box">
                    <div class="stat-value" id="balance">Loading...</div>
                    <div class="stat-label">Available Balance (USDT)</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" id="positions-count">0</div>
                    <div class="stat-label">Open Positions</div>
                </div>
                <div class="stat-box">
                    <div class="stat-value" id="orders-count">0</div>
                    <div class="stat-label">Open Orders</div>
                </div>
            </div>
        </div>
        
        <div class="card">
            <h2>📊 Current Positions</h2>
            <div id="positions-table">
                <p class="no-data">Loading positions...</p>
            </div>
        </div>
        
        <div class="card">
            <h2>📝 Open Orders</h2>
            <div id="orders-table">
                <p class="no-data">Loading orders...</p>
            </div>
        </div>
        
        <p class="refresh-info">⏱️ Auto-refreshing every 10 seconds</p>
    </div>
    
    <script>
        async function loadData() {
            try {
                // Load account balance
                const accountRes = await fetch('/api/account');
                const accountData = await accountRes.json();
                document.getElementById('balance').textContent = accountData.balance.toFixed(2);
                
                // Load positions
                const posRes = await fetch('/api/positions');
                const posData = await posRes.json();
                
                document.getElementById('positions-count').textContent = posData.positions.length;
                
                if (posData.positions.length > 0) {
                    let html = '<table><tr><th>Symbol</th><th>Amount</th><th>Entry Price</th><th>Mark Price</th><th>PNL</th><th>Leverage</th></tr>';
                    posData.positions.forEach(pos => {
                        const pnl = parseFloat(pos.unrealizedProfit);
                        const pnlClass = pnl >= 0 ? 'positive' : 'negative';
                        html += \`<tr>
                            <td><strong>\${pos.symbol}</strong></td>
                            <td>\${pos.positionAmt}</td>
                            <td>\${parseFloat(pos.entryPrice).toFixed(4)}</td>
                            <td>\${parseFloat(pos.markPrice).toFixed(4)}</td>
                            <td class="\${pnlClass}">\${pnl.toFixed(2)} USDT</td>
                            <td>\${pos.leverage}x</td>
                        </tr>\`;
                    });
                    html += '</table>';
                    document.getElementById('positions-table').innerHTML = html;
                } else {
                    document.getElementById('positions-table').innerHTML = '<p class="no-data">No open positions</p>';
                }
                
                // Load orders
                const ordersRes = await fetch('/api/orders');
                const ordersData = await ordersRes.json();
                
                document.getElementById('orders-count').textContent = ordersData.orders.length;
                
                if (ordersData.orders.length > 0) {
                    let html = '<table><tr><th>Symbol</th><th>Type</th><th>Side</th><th>Price</th><th>Quantity</th><th>Status</th></tr>';
                    ordersData.orders.forEach(order => {
                        html += \`<tr>
                            <td><strong>\${order.symbol}</strong></td>
                            <td>\${order.type}</td>
                            <td>\${order.side}</td>
                            <td>\${parseFloat(order.price || order.stopPrice || 0).toFixed(4)}</td>
                            <td>\${order.origQty}</td>
                            <td><span class="status active">\${order.status}</span></td>
                        </tr>\`;
                    });
                    html += '</table>';
                    document.getElementById('orders-table').innerHTML = html;
                } else {
                    document.getElementById('orders-table').innerHTML = '<p class="no-data">No open orders</p>';
                }
                
            } catch (error) {
                console.error('Error loading data:', error);
            }
        }
        
        // Load data on page load
        loadData();
        
        // Refresh every 10 seconds
        setInterval(loadData, 10000);
    </script>
</body>
</html>
        `;
    }

    /**
     * Stop web server
     */
    stop() {
        if (this.server) {
            this.server.close();
            logger.info('Web dashboard stopped');
        }
    }
}

export default WebDashboard;
