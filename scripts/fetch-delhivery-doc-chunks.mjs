import { writeFileSync } from 'node:fs';

const indexUrl = 'https://one.delhivery.com/developer-portal/assets/index.6fd9c88d.js';
const index = await (await fetch(indexUrl)).text();
const names = [
  'pincode',
  'serviceability',
  'tat',
  'freight_estimation',
  'freight-estimation',
  'freight_charges',
  'freight-charges',
];
const chunks = new Set();
for (const name of names) {
  const re = new RegExp(`import\\("./([^"]*${name}[^"]*\\.js)"\\)`, 'gi');
  for (const m of index.matchAll(re)) chunks.add(m[1]);
}
console.log('chunks', [...chunks]);

for (const file of chunks) {
  const url = `https://one.delhivery.com/developer-portal/assets/${file}`;
  const text = await (await fetch(url)).text();
  writeFileSync(`scripts/_doc_${file}`, text);
  console.log('\n====', file, text.length, '====');
  // Extract url/curl/pathParameters/fields heuristically
  const urlMatch = text.match(/url:"([^"]+)"/);
  const methodMatch = text.match(/method:"([^"]+)"/);
  const curlUrl = text.match(/url:"(https:[^"]+)"/);
  console.log({ url: urlMatch?.[1], method: methodMatch?.[1], curl: curlUrl?.[1] });
  console.log(text.slice(0, 2500));
}
