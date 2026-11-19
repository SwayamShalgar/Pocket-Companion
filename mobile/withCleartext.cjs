const { withAndroidManifest } = require('expo/config-plugins');

module.exports = config =>
  withAndroidManifest(config, result => {
    result.modResults.manifest.application[0].$[
      'android:usesCleartextTraffic'
    ] = 'true';

    return result;
  });