import * as fs from 'node:fs';
import * as dotenv from 'dotenv';

dotenv.config();

const scriptId = process.env.CLASP_SCRIPT_ID;

if (!scriptId) {
  console.error('❌ Error: CLASP_SCRIPT_ID no está definido en el archivo .env');
  process.exit(1);
}

const claspConfig = {
  "scriptId": scriptId,
  "rootDir": "./dist",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [],
  "skipSubdirectories": false
};

fs.writeFileSync('.clasp.json', JSON.stringify(claspConfig, null, 2));
console.log('✅ .clasp.json generado dinámicamente con TypeScript Nativo.');
