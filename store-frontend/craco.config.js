module.exports = {
  webpack: {
    configure: {
      ignoreWarnings: [/Failed to parse source map/],
      module: {
        rules: [
          {
            test: /\.js$/,
            enforce: 'pre',
            use: ['source-map-loader'],
            exclude: /node_modules\/html5-qrcode/,
          },
        ],
      },
    },
  },
};
