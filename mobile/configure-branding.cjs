const fs = require('node:fs');
const path = require('node:path');

process.chdir(__dirname);

const image = fs.readFileSync(
  path.join('assets', 'icon.png')
);

if (
  image.subarray(0, 8).toString('hex') !==
  '89504e470d0a1a0a'
) {
  throw new Error(
    'Save the downloaded PNG as assets/icon.png.'
  );
}

if (
  image.readUInt32BE(16) !==
  image.readUInt32BE(20)
) {
  throw new Error('The app icon must be square.');
}

const original = fs.readFileSync('app.json', 'utf8');
const config = JSON.parse(original);

if (!config.expo) {
  throw new Error(
    'app.json must contain an expo object.'
  );
}

const expo = config.expo;

expo.icon = './assets/icon.png';

expo.android = {
  ...expo.android,
  adaptiveIcon: {
    ...expo.android?.adaptiveIcon,
    foregroundImage: './assets/icon.png',
    backgroundColor: '#0b1020'
  }
};

expo.plugins = (expo.plugins || []).filter(
  plugin =>
    (Array.isArray(plugin) ? plugin[0] : plugin) !==
    'expo-splash-screen'
);

expo.plugins.push([
  'expo-splash-screen',
  {
    image: './assets/icon.png',
    imageWidth: 240,
    resizeMode: 'contain',
    backgroundColor: '#0b1020',
    dark: {
      image: './assets/icon.png',
      backgroundColor: '#0b1020'
    }
  }
]);

fs.writeFileSync(
  `app.backup-${Date.now()}.json`,
  original,
  { flag: 'wx' }
);

fs.writeFileSync(
  'app.json',
  JSON.stringify(config, null, 2) + '\n'
);

console.log(
  'Icon and native splash configured. Existing EAS project and plugins preserved.'
);