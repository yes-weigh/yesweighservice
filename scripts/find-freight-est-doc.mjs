import { writeFileSync } from 'node:fs';

const index = await (await fetch('https://one.delhivery.com/developer-portal/assets/index.6fd9c88d.js')).text();
for (const k of ['freight_estimation', 'freight-estimation', 'freight/estimate', 'B2B_FREIGHT']) {
  let i = 0;
  let n = 0;
  while ((i = index.indexOf(k, i)) !== -1 && n < 5) {
    console.log('\n', k, '@', i);
    console.log(index.slice(Math.max(0, i - 80), i + 220));
    i += k.length;
    n += 1;
  }
}
const chunks = [...index.matchAll(/import\("\.\/([^"]*freight[^"]*\.js)"\)/g)].map((m) => m[1]);
console.log('chunks', chunks);
for (const file of [...new Set(chunks)]) {
  if (file.includes('charges')) continue;
  const text = await (await fetch(`https://one.delhivery.com/developer-portal/assets/${file}`)).text();
  writeFileSync(`scripts/_doc_${file}`, text);
  console.log('\n====', file, '====');
  console.log(text.slice(0, 2200));
}
