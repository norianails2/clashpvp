import crypto from 'crypto';

export function adminAuth(req, res, next) {
  const token = req.headers['x-admin-key'];
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token || token.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
