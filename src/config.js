import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  db: {
    url: process.env.DATABASE_URL,
  },

  redis: {
    url: process.env.REDIS_URL,
  },

  telegram: {
    botToken: process.env.BOT_TOKEN || '8920598038:AAFdndgLQLxj_swUkfRGClMjQ_ynZNOXHEw',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  },

  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
  },
};
