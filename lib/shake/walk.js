'use strict';

const walk = require('acorn/dist/walk');

const BASE = Object.assign({
  // acorn-dynamic-import support
  Import: () => {}
}, walk.base);

// Pre-order walker
module.exports = (node, visitors) => {
  const state = null;
  const override = false;
  const ancestors = [];
  !function c(node, st, override) {
    var type = override || node.type, found = visitors[type];
    const isNew = node != ancestors[ancestors.length - 1];
    if (isNew) ancestors.push(node);
    if (found) found(node, st, ancestors);
    BASE[type](node, st, c);
    if (isNew) ancestors.pop();
  }(node, state, override);
};
