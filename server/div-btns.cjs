const fs = require('fs');
const f = 'C:/Users/eriks/AppData/Local/Temp/clashpvp/public/index.html';
let c = fs.readFileSync(f, 'utf8');

// Replace <button> with <div> for game action buttons
const btns = [
  ['bjHitBtn', 'pvp-bj-btn hit', '➕ Ещё'],
  ['bjStandBtn', 'pvp-bj-btn stand', '✋ Хватит'],
  ['bjStartBtn', 'c-main-btn', '🃏 СТАРТ'],
  ['minesStartBtn', 'c-main-btn', '💣 СТАРТ'],
  ['minesCashoutBtn', 'c-main-btn cashout', '◆ ЗАБРАТЬ <span id="minesMult">1.00</span>x'],
];
for (const [id, cls, label] of btns) {
  const regex = new RegExp(`<button[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/button>`);
  const match = c.match(regex);
  if (match) {
    const oldHtml = match[0];
    const display = oldHtml.includes('display:none') ? ' style="display:none;cursor:pointer;"' : ' style="cursor:pointer;"';
    const newHtml = `<div class="${cls}" id="${id}"${display}>${label}</div>`;
    c = c.replace(oldHtml, newHtml);
    console.log('Replaced:', id);
  } else {
    console.log('Not found:', id);
  }
}

fs.writeFileSync(f, c, 'utf8');
console.log('Done');
