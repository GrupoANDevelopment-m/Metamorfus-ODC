import { execSync } from 'child_process';
import * as fs from 'fs';
import { INITIAL_FILE_SYSTEM } from './constants';

function findFile(nodes: any[], name: string): any {
  for (const node of nodes) {
    if (node.name === name) return node;
    if (node.children) {
      const res = findFile(node.children, name);
      if (res) return res;
    }
  }
  return null;
}

const mhuFile = findFile(INITIAL_FILE_SYSTEM, 'mhu_engine.py');
if (mhuFile && mhuFile.content) {
  let content = mhuFile.content;
  content += `\nif __name__ == '__main__':\n    import json\n    engine = MHU_5_ProtoODC()\n    res = engine.execute_pipeline('Test input')\n    print(json.dumps(res, indent=2))\n`;
  fs.writeFileSync('mhu_temp.py', content);
  try {
    const res = execSync('python3 mhu_temp.py');
    console.log("Success:", res.toString());
  } catch (e: any) {
    console.log("Error:", e.stdout?.toString(), e.stderr?.toString(), e.message);
  }
} else {
  console.log("File not found");
}
