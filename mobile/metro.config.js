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

// three >= 0.18x ships its CommonJS entry as a shim that calls
// process.emitWarning and require(esm); neither exists under Hermes, so the
// 3D screen crashed on load. Always resolve `three` to the ES module build.
const THREE_ESM = path.resolve(__dirname, 'node_modules', 'three', 'build', 'three.module.js');
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: THREE_ESM };
  }
  return (upstreamResolve || context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
