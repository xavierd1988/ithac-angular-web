import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const browserDir = join(process.cwd(), 'dist', 'ithac-angular-web', 'browser');
const indexPath = join(browserDir, 'index.html');
const fallbackPath = join(browserDir, '404.html');

if (!existsSync(indexPath)) {
  throw new Error(`Missing build output: ${indexPath}`);
}

copyFileSync(indexPath, fallbackPath);
console.log(`SPA fallback written: ${fallbackPath}`);
