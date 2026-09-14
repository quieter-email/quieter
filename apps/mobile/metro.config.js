/* oxlint-disable eslint/require-unicode-regexp -- Expo's Metro ignore-pattern composer
   requires every block-list pattern to share identical flags. */

const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// Generated native project trees contain tens of thousands of build files.
// Watching them exhausts Node's file handles on Windows, so keep them out of
// Metro's file map.
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
