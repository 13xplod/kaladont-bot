const fs = require('fs');
const source = fs.readFileSync('serbian-words-latin.txt', 'utf8');
const dictText = fs.readFileSync('serbianDictionary.js', 'utf8');
const existing = new Set((dictText.match(/"([^\"]+)"/g) || []).map(x => x.slice(1, -1)));
const words = new Set(existing);
const valid = /^[a-zčćđšž]+$/;
const sourceWords = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
let added = 0;
for (const word of sourceWords) {
  if (!valid.test(word)) continue;
  if (existing.has(word)) continue;
  words.add(word);
  added += 1;
}
const sorted = [...words].sort((a, b) => a.localeCompare(b, 'sr'));
const out = ['module.exports = new Set(['];
for (const word of sorted) {
  out.push(`  "${word}",`);
}
out[out.length - 1] = out[out.length - 1].replace(/,$/, '');
out.push(']);');
fs.writeFileSync('serbianDictionary.js', out.join('\n') + '\n', 'utf8');
console.log('Added words:', added);
console.log('Dictionary now has', sorted.length, 'words.');
