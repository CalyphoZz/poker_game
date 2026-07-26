// Monorepo Metro config: this repo root is itself both the Expo app and the
// npm workspace root, with packages/poker-engine linked into node_modules via
// an npm workspace symlink/junction. Metro needs to follow that link and
// resolve poker-engine's own dependencies (e.g. pokersolver) from the root
// node_modules rather than expecting a nested node_modules under packages/.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.resolver.unstable_enableSymlinks = true;
config.watchFolders = [path.resolve(projectRoot, "packages")];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
