import { Router } from 'express';
import { getReferralStats, generateReferralLink } from '../services/referralService.js';
import { query } from '../db/pool.js';

const router = Router();

// Get referral stats
router.get('/stats', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const stats = await getReferralStats(userId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Get referral link
router.get('/link', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });

    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    const link = generateReferralLink(userId, botUsername);
    res.json({ link, botUsername });
  } catch (err) {
    next(err);
  }
});

// Apply referral (called when user opens mini app with startapp=ref_xxx)
router.post('/apply', async (req, res, next) => {
  try {
    const { referrerId } = req.body;
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'User ID required' });
    if (!referrerId) return res.status(400).json({ error: 'Referrer ID required' });

    const { applyReferral } = await import('../services/referralService.js');
    await applyReferral(userId, referrerId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
