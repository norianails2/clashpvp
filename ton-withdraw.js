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
    const { userId, amountUSDT, userWallet } = req.body;
    if (!amountUSDT || !userWallet) return res.status(400).json({ error: 'amountUSDT and userWallet required' });
    if (amountUSDT < 1) return res.status(400).json({ error: 'Minimum 1 USDT' });
    if (amountUSDT > 1000) return res.status(400).json({ error: 'Maximum 1000 USDT' });

    try {
        const base = process.env.SUPABASE_URL;
        let curBal = 0;
        if (userId) {
            const prof = await sfetch(base + '/rest/v1/profiles?id=eq.' + userId + '&select=balance');
            if (!prof || !prof[0]) return res.status(400).json({ error: 'User not found' });
            curBal = prof[0].balance || 0;
            if (curBal < amountUSDT) return res.status(400).json({ error: 'Insufficient balance' });
        }

        const mnemonic = process.env.APP_WALLET_MNEMONIC;
        if (!mnemonic) {
            if (userId) {
                await sfetch(base + '/rest/v1/profiles?id=eq.' + userId, { method: 'PATCH', body: JSON.stringify({ balance: curBal - amountUSDT }) });
                await sfetch(base + '/rest/v1/transactions', { method: 'POST', body: JSON.stringify({ user_id: userId, type: 'withdraw', amount: -amountUSDT, currency: 'USDT' }) });
            }
            return res.json({ success: true, simulated: true, amountUSDT });
        }

        const { mnemonicToPrivateKey } = await import('@ton/crypto');
        const { TonClient, WalletContractV4, internal } = await import('@ton/ton');
        const key = await mnemonicToPrivateKey(mnemonic.split(' '));
        const apik = process.env.TONCENTER_API_KEY;
        const client = new TonClient({ endpoint: 'https://toncenter.com/api/v2/jsonRPC', apiKey: apik || undefined });
        const wallet = WalletContractV4.create({ publicKey: key.publicKey, workchain: 0 });

        const rateRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
        const rateData = await rateRes.json();
        const tonPrice = rateData?.['the-open-network']?.usd || 5;
        const amountTON = (amountUSDT / tonPrice);

        const seqno = await client.runMethod(wallet.address, 'seqno').catch(() => ({ stack: '' }));
        const seqnoNum = seqno.stack ? Number(seqno.stack.readNumber()) : 0;
        const transfer = wallet.createTransfer({
            seqno: seqnoNum,
            secretKey: key.secretKey,
            messages: [internal({ to: userWallet, value: (amountTON * 1e9).toFixed(0), body: 'ClashPVP payout' })],
        });
        await client.sendMessage(transfer.toBoc().toString('base64'));

        if (userId) {
            await sfetch(base + '/rest/v1/profiles?id=eq.' + userId, { method: 'PATCH', body: JSON.stringify({ balance: curBal - amountUSDT }) });
            await sfetch(base + '/rest/v1/transactions', { method: 'POST', body: JSON.stringify({ user_id: userId, type: 'withdraw', amount: -amountUSDT, currency: 'USDT' }) });
        }
        return res.json({ success: true, simulated: false, amountTON, amountUSDT });
    } catch(e) {
        return res.status(500).json({ error: e.message || 'Withdrawal failed' });
    }
};
