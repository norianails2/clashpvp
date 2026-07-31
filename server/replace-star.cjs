const fs = require('fs');

const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 56'>
  <defs>
    <linearGradient id='stFill' x1='30%' y1='0%' x2='70%' y2='100%'>
      <stop stop-color='#FFFFFF' offset='0%'/>
      <stop stop-color='#F0F0F0' offset='100%'/>
    </linearGradient>
    <filter id='inner' x='-10%' y='-10%' width='120%' height='120%'>
      <feOffset dx='0' dy='1' in='SourceAlpha' result='soi'/>
      <feComposite in='soi' in2='SourceAlpha' operator='arithmetic' k2='-1' k3='1' result='sii'/>
      <feColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0' type='matrix' in='sii'/>
    </filter>
    <filter id='shd' x='-20%' y='-20%' width='140%' height='140%'>
      <feDropShadow dx='0' dy='1' stdDeviation='1.5' flood-color='#1a8cc4' flood-opacity='0.3'/>
    </filter>
    <path d='M 6.67 5.74 L 8.88 1.32 C 9.13 0.81 9.74 0.6 10.25 0.86 C 10.45 0.96 10.61 1.13 10.71 1.33 L 12.79 5.59 C 12.96 5.93 13.29 6.17 13.67 6.22 L 18.03 6.74 C 18.62 6.82 19.05 7.36 18.98 7.96 C 18.95 8.2 18.84 8.43 18.66 8.61 L 15.21 12.03 C 15.07 12.16 15.01 12.36 15.03 12.56 L 15.6 17.17 C 15.69 17.83 15.22 18.44 14.57 18.52 C 14.32 18.55 14.07 18.5 13.85 18.38 L 10.21 16.38 C 9.95 16.24 9.63 16.23 9.36 16.37 L 5.59 18.32 C 5.06 18.59 4.41 18.38 4.14 17.84 C 4.03 17.64 4 17.41 4.03 17.19 L 4.33 15.07 C 4.48 14.03 5.12 13.14 6.04 12.66 L 10.23 10.51 C 10.34 10.45 10.38 10.31 10.33 10.2 C 10.28 10.11 10.19 10.06 10.09 10.08 L 4.97 10.82 C 4.19 10.93 3.39 10.71 2.78 10.2 L 1.07 8.8 C 0.58 8.4 0.51 7.68 0.9 7.18 C 1.09 6.96 1.35 6.81 1.64 6.77 L 6.02 6.2 C 6.3 6.17 6.54 5.99 6.67 5.74 Z' id='st'/>
  </defs>
  <g transform='translate(3.5,3.5) scale(2.45)' filter='url(#shd)'>
    <use href='#st' fill='url(#stFill)' fill-rule='evenodd' filter='url(#inner)'/>
  </g>
</svg>`;
const enc = 'data:image/svg+xml,' + encodeURIComponent(svg);
const newCss = `.tg-s { display:inline-block;width:20px;height:20px;vertical-align:middle;margin:-2px 2px;background:url("${enc}") no-repeat center/contain; }`;

const files = [
  'C:/Users/eriks/Documents/Default Project/server/public/index.html',
  'C:/Users/eriks/Documents/Default Project/index.html'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/\.tg-s\s*\{[^}]+\}/g, newCss);
  fs.writeFileSync(file, content, 'utf8');
  console.log('Updated:', file);
}
console.log('Done');
