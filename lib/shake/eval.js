'use strict';

function evaluateBinary(node) {
  const op = node.operator;

  const left = evaluateConst(node.left);
  const right = evaluateConst(node.right);

  if (op === '+')
    return left + right;

  throw new Error(`Unsupported binary operation: "${op}"`);
}

function evaluateConst(node) {
  if (node.type === 'Literal')
    return node.value;

  if (node.type === 'BinaryExpression')
    return evaluateBinary(node);

  throw new Error(`Unsupported node type: "${node.type}"`);
}
module.exports = evaluateConst;
