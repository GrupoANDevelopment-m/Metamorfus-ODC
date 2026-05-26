const fs = require('fs');
const content = fs.readFileSync('constants.ts', 'utf-8');

// Extract all strings enclosed in backticks that look like Python code
const regex = /const \w+_PY_CONTENT = `([\s\S]*?)`;/g;
let match;
let i = 0;
while ((match = regex.exec(content)) !== null) {
  fs.writeFileSync(`test_py_${i}.py`, match[1]);
  i++;
}
console.log(`Extracted ${i} python files.`);
