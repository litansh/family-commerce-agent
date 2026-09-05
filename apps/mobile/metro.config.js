// Monorepo-aware Metro: resolve workspace packages and hoisted node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];
module.exports = config;
