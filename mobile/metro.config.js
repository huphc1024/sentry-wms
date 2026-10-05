const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Nested react-native under virtualized-lists breaks Expo 54 / RN 0.81 codegen.
config.resolver.blockList = [
  /node_modules[\\/]react-native[\\/]node_modules[\\/]react-native[\\/].*/,
];

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'react-native': path.resolve(__dirname, 'node_modules', 'react-native'),
};

module.exports = config;
