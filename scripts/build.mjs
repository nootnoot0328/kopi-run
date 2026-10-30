import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'settings.js', 'team.js', 'people.js', 'sw.js']) await copyFile(file, `dist/${file}`);
