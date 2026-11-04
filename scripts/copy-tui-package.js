// Marca dist/tui como ESM (tsc no copia package.json)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
fs.copyFileSync(path.join(root, 'src', 'tui', 'package.json'), path.join(root, 'dist', 'tui', 'package.json'));
