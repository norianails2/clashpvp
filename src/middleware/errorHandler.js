export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message = err.expose ? err.message : 'Internal server error';

  if (status === 500) {
    console.error('[ERROR]', err);
  }

  res.status(status).json({ error: message });
}

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}
