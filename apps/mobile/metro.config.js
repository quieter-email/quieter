/* oxlint-disable eslint/require-unicode-regexp -- Expo's Metro ignore-pattern composer
   requires every block-list pattern to share identical flags. */

const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// Watching the repository root pulls in the hoisted node_modules tree and the
// generated native build trees; on Windows that exhausts the process's file
// handles after a while (EMFILE). Watch only the app and the shared packages
// it imports; a dependency install needs a Metro restart, which is expected.
config.watchFolders = [__dirname, path.resolve(__dirname, "../../packages")];

// Generated native project trees contain tens of thousands of build files.
// Keep them out of Metro's file map as well.
const existingBlockList = config.resolver.blockList;
const existingPatterns = Array.isArray(existingBlockList)
  ? existingBlockList.filter(Boolean)
  : [existingBlockList].filter(Boolean);

config.resolver.blockList = [
  ...existingPatterns,
  /[/\\]android[/\\].*[/\\]build[/\\].*/,
  /[/\\]android[/\\]\.cxx[/\\].*/,
  /[/\\]android[/\\]\.gradle[/\\].*/,
  /[/\\]ios[/\\]Pods[/\\].*/,
  /[/\\]\.expo-export[/\\].*/,
];

// withUniwindConfig must stay the outermost wrapper so class scanning sees
// every source file the monorepo graph can reach.
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
