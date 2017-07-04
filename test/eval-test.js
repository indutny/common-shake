'use strict';
/* globals describe it */

const assert = require('assert');
const fixtures = require('./fixtures');

const shake = require('../');
const evaluateConst = shake.evaluateConst;

const parse = (source) => {
  return fixtures.parse(source).body[0].expression;
};

describe('Evaluator', () => {
  it('should evaluate number literal', () => {
    assert.strictEqual(evaluateConst(parse('1')), 1);
  });

  it('should evaluate string literal', () => {
    assert.strictEqual(evaluateConst(parse('"1"')), '1');
  });

  it('should evaluate binary addition', () => {
    assert.strictEqual(evaluateConst(parse('"1" + "2"')), '12');
  });

  it('should throw on unknown binary operation', () => {
    assert.throws(() => {
      evaluateConst(parse('"1" / "2"'));
    });
  });

  it('should throw on unknown node type', () => {
    assert.throws(() => {
      evaluateConst(parse('a()'));
    });
  });
});
