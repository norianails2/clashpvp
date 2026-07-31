import { config } from '../config.js';

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

export function adminAuth(req, res, next) {
  const token = req.headers['x-admin-key'];
  if (!token || token !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
