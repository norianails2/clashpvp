const fs = require('fs');
const path = 'C:/Users/eriks/AppData/Local/Temp/clashpvp/public/index.html';
let c = fs.readFileSync(path, 'utf8');

// Replace renderSoloBJ to set up button references
const newRender = `function renderSoloBJ(area) {
    document.getElementById('gameTitle').textContent = '🃏 Блекджек';
    area.innerHTML =
        '<div class="bj-solo" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:0 16px;">' +
        '<div class="bj-solo-table" style="width:100%;">' +
        '<div class="bj-row"><div class="bj-label">🎩 ДИЛЕР <span class="bj-score" id="bjDealerScore">?</span></div><div class="bj-hand" id="bjDealerHand"></div></div>' +
        '<div class="bj-row"><div class="bj-label">👤 ТЫ <span class="bj-score" id="bjPlayerScore">0</span></div><div class="bj-hand" id="bjPlayerHand"></div></div>' +
        '</div>' +
        '<div class="pvc-label" style="margin-top:4px;position:relative;z-index:1;">✦ СТАВКА</div>' +
        '<div class="pvc-row"><div class="pvc-input-wrap"><span class="pvc-star"><i class="tg-s"></i></span>' +
        '<input type="number" id="bjBetInput" value="10" min="1"><span class="pvc-currency">★</span></div>' +
        '<div class="pvc-adj"><button id="bjAdjMin">MIN</button><button id="bjAdjHalf">½</button><button id="bjAdjDbl">2×</button><button id="bjAdjMax">MAX</button></div></div>' +
        '<div style="display:flex;gap:8px;align-items:center;min-height:40px;" id="bjActions">' +
        '<button class="c-main-btn" id="bjStartBtn">🃏 СТАРТ</button>' +
        '<button class="pvp-bj-btn hit" id="bjHitBtn" style="display:none;">➕ Ещё</button>' +
        '<button class="pvp-bj-btn stand" id="bjStandBtn" style="display:none;">✋ Хватит</button></div>' +
        '<div style="font-size:14px;color:#fbbf24;font-weight:700;min-height:22px;" id="bjStatus">Установи ставку и нажми СТАРТ</div>' +
        '</div>';
    setTimeout(function() {
        var b = document.getElementById('bjStartBtn'); if (b) b.onclick = bjStart;
        var h = document.getElementById('bjHitBtn'); if (h) h.onclick = bjHit;
        var s = document.getElementById('bjStandBtn'); if (s) s.onclick = bjStand;
        var a = document.getElementById('bjAdjMin'); if (a) a.onclick = function(){bjAdjBet('min');};
        var p = document.getElementById('bjAdjHalf'); if (p) p.onclick = function(){bjAdjBet('half');};
        var d = document.getElementById('bjAdjDbl'); if (d) d.onclick = function(){bjAdjBet('double');};
        var m = document.getElementById('bjAdjMax'); if (m) m.onclick = function(){bjAdjBet('max');};
    }, 0);
}`;

c = c.replace(/function renderSoloBJ\(area\)[\s\S]*?^}/m, newRender);

// Also update renderSoloMines similarly
const mineRenderEnd = 'g.appendChild(c);\n    }\n}';
const mineRenderNew = `g.appendChild(c);
    }
    setTimeout(function() {
        var s = document.getElementById('minesStartBtn'); if (s) s.onclick = minesStart;
        var c = document.getElementById('minesCashoutBtn'); if (c) c.onclick = minesCashout;
    }, 0);
}`;
c = c.replace(mineRenderEnd, mineRenderNew);

fs.writeFileSync(path, c, 'utf8');
console.log('Updated');
