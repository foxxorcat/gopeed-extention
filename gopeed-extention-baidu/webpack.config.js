import path from 'path';
import { fileURLToPath } from 'url';
import GopeedPolyfillPlugin from 'gopeed-polyfill-webpack-plugin';

const __dirname = fileURLToPath(import.meta.url);

export default {
  entry: './src/index.js',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, '../dist'),
  },
  resolve: {
    alias: {
      // 默认browser的self直接使用存在问题
      '@badgateway/oauth2-client': '@badgateway/oauth2-client/dist/index.js'
    }
  },
  devtool: false,
  plugins: [new GopeedPolyfillPlugin()],
  module: {
    rules: [
      {
        test: /\.m?js$/,
        use: {
          loader: 'babel-loader',
        },
      },
    ],
  },
};
