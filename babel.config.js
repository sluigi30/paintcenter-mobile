module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // VisionCamera frame processors run in worklets — this plugin compiles them.
      // processNestedWorklets: lets a worklet defined INSIDE another worklet
      // (e.g. runAsync(...) inside the frame processor) get compiled too.
      // Must come BEFORE the reanimated plugin.
      ['react-native-worklets-core/plugin', { processNestedWorklets: true }],
      // Reanimated's plugin must always be listed LAST.
      'react-native-reanimated/plugin',
    ],
  };
};
