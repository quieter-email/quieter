const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// Generated native project trees contain tens of thousands of build files.
// Watching them exhausts Node's file handles on Windows, so keep them out of
// Metro's file map.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList].filter(Boolean)),
  /[/\\]android[/\\].*[/\\]build[/\\].*/u,
  /[/\\]android[/\\]\.cxx[/\\].*/u,
  /[/\\]android[/\\]\.gradle[/\\].*/u,
  /[/\\]ios[/\\]Pods[/\\].*/u,
  /[/\\]\.expo-export[/\\].*/u,
];

// withUniwindConfig must stay the outermost wrapper so class scanning sees
// every source file the monorepo graph can reach.
module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
