const fs = require('fs');
const source = fs.readFileSync('serbian-words-latin.txt', 'utf8');
const bannedPath = 'bannedWords.js';
const bannedText = fs.readFileSync(bannedPath, 'utf8');
const existing = new Set((bannedText.match(/'([^']+)'/g) || []).map(x => x.slice(1, -1).toLowerCase()));
const lines = source.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
const proper = new Set(existing);
for (const line of lines) {
  if (/^[A-ZČĆĐŠŽ][a-zčćđšž]+$/.test(line)) {
    proper.add(line.toLowerCase());
  }
}
const sorted = [...proper].sort((a, b) => a.localeCompare(b, 'sr'));
const output = ['// Shared banned word list used by the Kaladont bot to reject proper nouns, cities, brands, and names.', 'module.exports = new Set(['];
for (const word of sorted) {
  output.push(`  '${word}',`);
}
if (output.length > 2) {
  output[output.length - 1] = output[output.length - 1].replace(/,$/, '');
}
output.push(']);');
fs.writeFileSync(bannedPath, output.join('\n') + '\n', 'utf8');
console.log('Updated bannedWords.js with', sorted.length, 'entries.');
