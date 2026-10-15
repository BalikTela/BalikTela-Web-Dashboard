import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import express, { type Express } from 'express';

export function serveWebApp(app: Express, directory = resolve('dist')) {
  const index = resolve(directory, 'index.html');
  if (!existsSync(index)) throw new Error('Dashboard build is missing. Run npm run build:render before npm start.');
  app.use('/assets', express.static(resolve(directory, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }));
  app.use(express.static(directory, { index: false, maxAge: '1h', dotfiles: 'deny' }));
  app.get('/{*path}', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/') || extname(req.path) || req.path.split('/').some(segment => segment.startsWith('.'))) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
