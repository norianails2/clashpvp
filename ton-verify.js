async function sfetch(url, opts) {
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!key) return null;
    const res = await fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + key, ...(opts.headers||{}) }
    });
    return res.json();
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { userId, userWallet } = req.body;
    if (!userWallet) return res.status(400).json({ error: 'userWallet required' });

    try {
        const appWallet = process.env.APP_WALLET_ADDRESS;
        if (!appWallet) return res.json({ verified: false, error: 'APP_WALLET_ADDRESS not configured' });

        const hdrs = { 'Content-Type': 'application/json' };
        const apik = process.env.TONCENTER_API_KEY;
        if (apik) hdrs['X-API-Key'] = apik;

        const txRes = await fetch(`https://toncenter.com/api/v2/transactions?account=${appWallet}&limit=15&sort=desc`, { headers: hdrs });
        const txData = await txRes.json();
        if (!txData.ok || !txData.result) return res.json({ verified: false, error: 'Failed to fetch transactions' });

        const recentTx = txData.result.filter(tx => tx.out_msgs && tx.out_msgs[0] && tx.out_msgs[0].destination === userWallet);
        if (recentTx.length > 0) {
            const tx = recentTx[0];
            const amountTON = parseFloat(tx.out_msgs[0].value) / 1e9;
            const amountUSDT = amountTON * 100;
            const txHash = tx.transaction_id?.hash || tx.hash || 'unknown';
            if (userId) {
                const base = process.env.SUPABASE_URL;
                const prof = await sfetch(base + '/rest/v1/profiles?id=eq.' + userId + '&select=balance');
                if (prof && prof[0]) {
                    const cur = prof[0].balance || 0;
                    await sfetch(base + '/rest/v1/profiles?id=eq.' + userId, { method: 'PATCH', body: JSON.stringify({ balance: cur + amountUSDT }) });
                    await sfetch(base + '/rest/v1/transactions', { method: 'POST', body: JSON.stringify({ user_id: userId, type: 'deposit', amount: amountUSDT, currency: 'USDT' }) });
                }
            }
            return res.json({ verified: true, amountTON, amountUSDT, txHash });
        }
        return res.json({ verified: false });
    } catch(e) {
        return res.status(500).json({ error: e.message || 'Internal error' });
    }
};
