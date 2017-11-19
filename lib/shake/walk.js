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
  !function c(node, st, override) {
    var type = override || node.type, found = visitors[type];
    if (found) found(node, st);
    BASE[type](node, st, descend(node, c));
  }(node, state, override);

  // Add a `.parentNode` property to nodes during the walk.
  function descend(node, c) {
    return (child, st, override) => {
      if (child !== node) child.parentNode = node;
      c(child, st, override);
    };
  }
};
