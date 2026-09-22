import fs from 'fs';

const tsContent = fs.readFileSync('src/constants.ts', 'utf-8');
const metaprogStart = tsContent.indexOf("id: 'metaprog.py'");
const contentMatch = tsContent.slice(metaprogStart).match(/content: `([\s\S]*?)`\s*\},/);
if (contentMatch) {
  fs.writeFileSync('test_metaprog.py', contentMatch[1]);
  console.log('test_metaprog.py saved');
} else {
  console.log('failed to match');
}
