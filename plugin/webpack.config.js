import { resolve } from "path";
import CopyWebpackPlugin from "copy-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import webpack from "webpack";
import { aliases } from "@swc-uxp-wrappers/utils";

const shared = {
  entry: "./src/index.js",
  output: {
    path: resolve("dist"),
    filename: "bundle.js",
  },
  // uxp / premierepro / os sont fournis par l'hôte -> ne pas bundler.
  externals: {
    uxp: "commonjs uxp",
    premierepro: "commonjs premierepro",
    os: "commonjs os",
  },
  plugins: [
    new HtmlWebpackPlugin({ template: "src/index.html" }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "manifest.json", to: resolve("dist") },
        { from: "icons", to: resolve("dist/icons") },
      ],
    }),
    // UXP gère mal les chunks dynamiques -> un seul bundle.
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
  ],
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: { loader: "babel-loader" },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".js", ".jsx", ".json"],
    // Requis pour que les Spectrum Web Components marchent dans UXP.
    alias: aliases,
  },
};

export default shared;
