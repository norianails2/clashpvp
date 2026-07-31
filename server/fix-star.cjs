const fs = require('fs');

const newCss = `.tg-s { display:inline-block;width:1em;height:1em;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%2332B6E8;stop-opacity:1' /%3E%3Cstop offset='50%25' style='stop-color:%23D332D3;stop-opacity:1' /%3E%3Cstop offset='100%25' style='stop-color:%23FF6AB0;stop-opacity:1' /%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M12 2c.22 0 .43.1.58.28l2.94 4.54a1 1 0 0 0 .84.45h5.4c.3 0 .58.17.7.46s.08.62-.12.82l-4.1 4a1 1 0 0 0 -.3.96l1.37 5.25c.08.31-.03.65-.29.84a.78.78 0 0 1-.9 0L12 17a1 1 0 0 0 -1.18 0l-4.66 3a.78.78 0 0 1-.9 0c-.26-.2-.37-.53-.29-.84l1.37-5.25a1 1 0 0 0 -.3-.96l-4.1-4c-.2-.2-.24-.53-.12-.82.12-.3.4-.46.7-.46h5.4a1 1 0 0 0 .84-.45l2.94-4.54c.15-.18.36-.28.58-.28z' fill='url(%23grad)' stroke='%23ffffff' stroke-width='0.7' stroke-linejoin='round' /%3E%3C/svg%3E");background-repeat:no-repeat;background-position:center;background-size:contain;vertical-align:text-bottom;filter:drop-shadow(0 0 2px rgba(211,50,211,0.5)) drop-shadow(0 0 5px rgba(50,182,232,0.3)); }`;

const files = [
  'C:/Users/eriks/AppData/Local/Temp/clashpvp/public/index.html',
  'C:/Users/eriks/AppData/Local/Temp/clashpvp/index.html',
  'C:/Users/eriks/Documents/Default Project/server/public/index.html',
  'C:/Users/eriks/Documents/Default Project/index.html'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\.tg-s\s*\{[^}]+\}/g, newCss);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Updated:', file);
}
