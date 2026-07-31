import localtunnel from 'localtunnel';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

async function start() {
  const tunnel = await localtunnel({ port: 3001, subdomain: 'clashpvp' });
  const url = tunnel.url;
  console.log(`[tunnel] URL: ${url}`);

  // Update .env
  let env = fs.readFileSync(envPath, 'utf-8');
  const setOrAdd = (key, val) => {
    const re = new RegExp(`^${key}=.*`, 'm');
    if (re.test(env)) {
      env = env.replace(re, `${key}=${val}`);
    } else {
      env += `\n${key}=${val}`;
    }
  };
  setOrAdd('DOMAIN', url);
  const miniAppUrl = url.replace('https://', 'https://');
  setOrAdd('MINI_APP_URL', miniAppUrl);
  fs.writeFileSync(envPath, env);
  console.log(`[tunnel] .env updated with DOMAIN=${url} and MINI_APP_URL`);

  tunnel.on('close', () => {
    console.log('[tunnel] closed');
    process.exit(0);
  });

  console.log(`[tunnel] Keep running. Press Ctrl+C to stop.`);
}

start().catch(err => { console.error(err); process.exit(1); });
