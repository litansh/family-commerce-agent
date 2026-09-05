// Monorepo-aware Metro. Watch only what the app imports: its own tree, the
// domain package, and the hoisted node_modules. Watching the whole repo
// (terraform, runs, api bundles) overwhelmed the file watcher and edits under
// src/ went unnoticed until a cold restart.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [
  path.resolve(root, 'packages/domain'),
  path.resolve(root, 'node_modules'),
];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules'), path.resolve(root, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];
module.exports = config;
