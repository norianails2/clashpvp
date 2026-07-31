import { Router } from 'express';
import { getReferralStats, generateReferralLink } from '../services/referralService.js';
import { telegramRestAuth } from '../middleware/telegramRestAuth.js';

const router = Router();
router.use(telegramRestAuth);

// Get referral stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getReferralStats(req.userId);
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// Get referral link
router.get('/link', async (req, res, next) => {
  try {
    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    const link = generateReferralLink(req.userId, botUsername);
    res.json({ link, botUsername });
  } catch (err) {
    next(err);
  }
});

// Apply referral (called when user opens mini app with startapp=ref_xxx)
router.post('/apply', async (req, res, next) => {
  try {
    const { referrerId } = req.body;
    if (!referrerId) return res.status(400).json({ error: 'Referrer ID required' });

    const { applyReferral } = await import('../services/referralService.js');
    await applyReferral(req.userId, referrerId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
