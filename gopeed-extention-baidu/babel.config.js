/** @param {import('@babel/preset-env').Options} options */
const definePresetEnvOption = (options) => options

/** @type {import('@babel/core').TransformOptions} */
export default {
  presets: [
    [
      '@babel/preset-env',
      definePresetEnvOption({
        exclude: ['transform-async-to-generator', 'transform-regenerator'],
        useBuiltIns: false,
      })
    ],
  ],
};
