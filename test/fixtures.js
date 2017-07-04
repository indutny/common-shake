'use strict';

const acorn = require('acorn-dynamic-import').default;

exports.parse = (source) => {
  return acorn.parse(source, {
    locations: true,
    sourceType: 'module',
    ecmaVersion: 2017,
    plugins: {
      dynamicImport: true
    }
  });
};
