const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Let Metro bundle the on-device ML model (.tflite) as an app asset,
// so the wall-segmentation model ships inside the app (no server download).
config.resolver.assetExts.push('tflite');

module.exports = config;
