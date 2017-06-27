'use strict';

const assert = require('assert');
const acorn = require('acorn');

const shake = require('../');
const Analyzer = shake.Analyzer;

const EMPTY = {
  bailouts: false,
  uses: [],
  declarations: []
};

function parse(source) {
  return acorn.parse(source, {
    locations: true
  });
}

describe('Analyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new Analyzer();
  });

  afterEach(() => {
    analyzer = null;
  });

  it('should find all exported values', () => {
    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;

      !function() {
        exports.c = 3;
      }();
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [],
      declarations: [ 'a', 'b', 'c' ]
    });
  });

  it('should find all imported values', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      lib.a();
      lib.b();
      require('./a').c();
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
      exports.c = 3;
      exports.d = 4;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo(), {
      bailouts: false,
      uses: [ 'a', 'b', 'c' ],
      declarations: [ 'a', 'b', 'c', 'd' ]
    });
  });

  it('should find all self-used values', () => {
    analyzer.run(parse(`
      exports.a = 1;
      exports.b = () => {};

      exports.c = () => {
        return exports.b();
      };
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [ 'b' ],
      declarations: [ 'a', 'b', 'c' ]
    });
  });

  it('should not count disguised `exports` use as export', () => {
    analyzer.run(parse(`
      function a() {
        var exports = {};
        exports.a = a;
      }

      exports.b = 1;
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [],
      declarations: [ 'b' ]
    });
  });

  it('should not count disguised `require` use as import', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      lib.a();
      function a() {
        const require = () => {};
        const lib = require('./a');
        lib.b();
      }
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo(), {
      bailouts: false,
      uses: [ 'a' ],
      declarations: [ 'a', 'b' ]
    });
  });

  it('should not count redefined variable as import', () => {
    analyzer.run(parse(`
      var lib = require('./a');

      lib.a();

      var lib = {};
      lib.b();
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo(), {
      bailouts: [
        {
          loc: {
            start: { column: 10, line: 2 },
            end: { column: 30, line: 2 }
          },
          source: 'root',
          reason: '`require` variable override'
        }
      ],
      uses: [],
      declarations: [ 'a', 'b' ]
    });
  });

  it('should bailout on assignment to `exports`', () => {
    analyzer.run(parse(`
      exports = {};
      exports.a = 1;
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 18, line: 2 }
        },
        source: null,
        reason: '`exports` assignment'
      }
    ]);
  });

  it('should bailout on assignment to `require`', () => {
    analyzer.run(parse(`
      require = () => {};
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 24, line: 2 }
        },
        source: null,
        reason: '`require` assignment'
      }
    ]);
  });

  it('should bailout on dynamic `require`', () => {
    analyzer.run(parse(`
      const lib = require(Math.random());
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 18, line: 2 },
          end: { column: 40, line: 2 }
        },
        source: null,
        reason: 'Dynamic argument of `require`'
      }
    ]);
  });

  it('should bailout on assignment to `module.exports`', () => {
    analyzer.run(parse(`
      module.exports = () => {};
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 31, line: 2 }
        },
        source: null,
        reason: '`module.exports` assignment'
      }
    ]);
  });

  it('should bailout on dynamic export', () => {
    analyzer.run(parse(`
      exports[Math.random()] = 1;
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 28, line: 2 }
        },
        source: null,
        reason: 'Dynamic CommonJS export'
      }
    ]);
  });

  it('should bailout on dynamic `module` use', () => {
    analyzer.run(parse(`
      module[Math.random()] = 1;
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 27, line: 2 }
        },
        source: null,
        reason: 'Dynamic `module` use'
      }
    ]);
  });

  it('should bailout on dynamic self-use', () => {
    analyzer.run(parse(`
      exports[Math.random()]();
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 28, line: 2 }
        },
        source: null,
        reason: 'Dynamic CommonJS use'
      }
    ]);
  });

  it('should bailout on dynamic import', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      lib[Math.random()]();
    `), 'root');

    analyzer.run(parse(''), 'a');
    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 4 },
          end: { column: 24, line: 4 }
        },
        source: 'root',
        reason: 'Dynamic CommonJS import'
      }
    ]);
  });

  it('should bailout on assignment to imported library', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      lib.override = true;
    `), 'root');

    analyzer.run(parse(''), 'a');
    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 4 },
          end: { column: 25, line: 4 }
        },
        source: 'root',
        reason: 'Module property assignment'
      }
    ]);
  });

  it('should bailout on escaping imported library', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      send(lib);
    `), 'root');

    analyzer.run(parse(''), 'a');
    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 11, line: 4 },
          end: { column: 14, line: 4 }
        },
        source: 'root',
        reason: 'Escaping value or unknown use'
      }
    ]);
  });
});
