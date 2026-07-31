const fs = require('fs');
const f = 'C:/Users/eriks/AppData/Local/Temp/clashpvp/public/index.html';
let c = fs.readFileSync(f, 'utf8');

// 1. Remove static buttons I just added (between gameArea and next closing div)
c = c.replace(/\n        <!-- Static buttons[\s\S]*?\n    <\/div>/, '\n    <\/div>');

// 2. Change renderSoloBJ buttons to divs with onmousedown
c = c.replace(
  "'<button class=\"c-main-btn\" id=\"bjStartBtn\">\u{1F0CF} \u{0421}\u{0422}\u{0410}\u{0420}\u{0422}</button>'",
  "'<div class=\"c-main-btn\" id=\"bjStartBtn\" onmousedown=\"bjStart()\" style=\"cursor:pointer;display:inline-block;padding:12px 24px;border-radius:9999px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a0a2e;font-family:Nunito,sans-serif;font-size:14px;font-weight:800;\">\u{1F0CF} \u{0421}\u{0422}\u{0410}\u{0420}\u{0422}</div>'"
);

c = c.replace(
  "'<button class=\"pvp-bj-btn hit\" id=\"bjHitBtn\" style=\"display:none;\">\u{2795} \u{0415}\u{0449}\u{0451}</button>'",
  "'<div class=\"pvp-bj-btn hit\" id=\"bjHitBtn\" style=\"display:none;cursor:pointer;display:inline-block;padding:8px 20px;border-radius:9999px;background:rgba(255,255,255,0.08);color:#fff;border:1px solid rgba(255,255,255,0.12);font-family:Nunito,sans-serif;font-size:13px;font-weight:700;\" onmousedown=\"bjHit()\">\u{2795} \u{0415}\u{0449}\u{0451}</div>'"
);

c = c.replace(
  "'<button class=\"pvp-bj-btn stand\" id=\"bjStandBtn\" style=\"display:none;\">\u{270B} \u{0425}\u{0432}\u{0430}\u{0442}\u{0438}\u{0442}</button>'",
  "'<div class=\"pvp-bj-btn stand\" id=\"bjStandBtn\" style=\"display:none;cursor:pointer;display:inline-block;padding:8px 20px;border-radius:9999px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a0a2e;font-family:Nunito,sans-serif;font-size:13px;font-weight:700;\" onmousedown=\"bjStand()\">\u{270B} \u{0425}\u{0432}\u{0430}\u{0442}\u{0438}\u{0442}</div>'"
);

// 3. Mines buttons
c = c.replace(
  "'<button class=\"c-main-btn mines-act-btn\" id=\"minesStartBtn\" data-act=\"start\">\u{1F4A3} \u{0421}\u{0422}\u{0410}\u{0420}\u{0422}</button>'",
  "'<div class=\"c-main-btn\" id=\"minesStartBtn\" onmousedown=\"minesStart()\" style=\"cursor:pointer;display:inline-block;padding:12px 24px;border-radius:9999px;background:linear-gradient(135deg,#fbbf24,#f59e0b);color:#1a0a2e;font-family:Nunito,sans-serif;font-size:14px;font-weight:800;\">\u{1F4A3} \u{0421}\u{0422}\u{0410}\u{0420}\u{0422}</div>'"
);

c = c.replace(
  "'<button class=\"c-main-btn cashout mines-act-btn\" id=\"minesCashoutBtn\" data-act=\"cashout\" style=\"display:none;\">\u{25C6} \u{0417}\u{0410}\u{0411}\u{0420}\u{0410}\u{0422}\u{042C} <span id=\"minesMult\">1.00</span>x</button>'",
  "'<div class=\"c-main-btn cashout\" id=\"minesCashoutBtn\" style=\"display:none;cursor:pointer;display:inline-block;padding:12px 24px;border-radius:9999px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-family:Nunito,sans-serif;font-size:14px;font-weight:800;\" onmousedown=\"minesCashout()\">\u{25C6} \u{0417}\u{0410}\u{0411}\u{0420}\u{0410}\u{0422}\u{042C} <span id=\"minesMult\">1.00</span>x</div>'"
);

fs.writeFileSync(f, c, 'utf8');
console.log('Fixed: buttons -> divs with onmousedown');
