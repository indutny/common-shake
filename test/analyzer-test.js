'use strict';
/* globals describe it beforeEach afterEach */

const assert = require('assert');
const fixtures = require('./fixtures');
const parse = fixtures.parse;

const shake = require('../');
const Analyzer = shake.Analyzer;

const EMPTY = {
  bailouts: false,
  uses: [],
  declarations: []
};

function simplifyDecl(decl) {
  return {
    type: decl.type,
    name: decl.name,
    ast: decl.ast.type
  };
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
        module.exports.c = 3;
      }();
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [],
      declarations: [ 'a', 'b', 'c' ]
    });

    const decls = analyzer.getModule('root').getDeclarations();

    assert.deepEqual(decls.map(simplifyDecl), [
      { type: 'exports', name: 'a', ast: 'AssignmentExpression' },
      { type: 'exports', name: 'b', ast: 'AssignmentExpression' },
      { type: 'exports', name: 'c', ast: 'AssignmentExpression' }
    ]);
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

      exports.d = () => {
        return module.exports.c();
      };
    `), 'root');

    analyzer.getModule('root').use('d', analyzer.getModule('root'), false);

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [ 'd', 'b', 'c' ],
      declarations: [ 'a', 'b', 'c', 'd' ]
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

  it('should support object destructuring', () => {
    analyzer.run(parse(`
      const { a, b } = require('./a');
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
      exports.c = 3;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo(), {
      bailouts: false,
      uses: [ 'a', 'b' ],
      declarations: [ 'a', 'b', 'c' ]
    });
  });

  it('should not support dynamic object destructuring', () => {
    analyzer.run(parse(`
      const prop = 'a';
      const { [prop]: name } = require('./a');
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
      exports.c = 3;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 12, line: 3 },
          end: { column: 28, line: 3 }
        },
        source: 'root',
        reason: 'Dynamic properties in `require` destructuring',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should not support array destructuring', () => {
    analyzer.run(parse(`
      const [ a, b ] = require('./a');
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
      exports.c = 3;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 12, line: 2 },
          end: { column: 37, line: 2 }
        },
        source: 'root',
        reason: '`require` used in unknown way',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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

      var lib = require('./b');
      lib.b();
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
    `), 'a');

    analyzer.resolve('root', './a', 'a');
    analyzer.resolve('root', './b', 'b');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo(), {
      bailouts: [
        {
          loc: {
            start: { column: 10, line: 2 },
            end: { column: 30, line: 2 }
          },
          source: 'root',
          reason: '`require` variable override',
          level: 'warning'
        }
      ],
      uses: [],
      declarations: [ 'a', 'b' ]
    });
    assert.deepEqual(analyzer.getModule('b').getInfo(), {
      bailouts: [
        {
          loc: {
            start: { column: 10, line: 6 },
            end: { column: 30, line: 6 }
          },
          source: 'root',
          reason: '`require` variable override',
          level: 'warning'
        }
      ],
      uses: [],
      declarations: []
    });
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: '`exports` assignment',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: '`require` assignment',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: 'Dynamic argument of `require`',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, [
      {
        loc: {
          start: { column: 18, line: 2 },
          end: { column: 40, line: 2 }
        },
        source: 'root',
        reason: 'Dynamic argument of `require`'
      }
    ]);
  });

  it('should not bailout use of `require` properties', () => {
    analyzer.run(parse(`
      require.cache[a] = 1;
    `), 'root');

    assert(analyzer.isSuccess());
    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
  });

  it('should bailout on invalide use of `require`', () => {
    analyzer.run(parse(`
      escape(require);
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 13, line: 2 },
          end: { column: 20, line: 2 }
        },
        source: null,
        reason: 'Invalid use of `require`',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, [
      {
        loc: {
          start: { column: 13, line: 2 },
          end: { column: 20, line: 2 }
        },
        source: 'root',
        reason: 'Invalid use of `require`'
      }
    ]);
  });

  it('should not bailout on `typeof require`', () => {
    analyzer.run(parse(`
      if (typeof require === 'function') {
        console.log("ok");
      }
    `), 'root');

    assert.strictEqual(analyzer.getModule('root').getInfo().bailouts, false);
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
        reason: '`module.exports` assignment',
        level: 'info'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should not bailout on assignment to other `module` properties', () => {
    analyzer.run(parse(`
      module.lamports = () => {};
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, false);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should support object literal in `module.exports`', () => {
    analyzer.run(parse(`
      module.exports = {
        a: 1,
        "b": 2
      };
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [],
      declarations: [ 'a', 'b' ]
    });

    const decls = analyzer.getModule('root').getDeclarations();
    assert.deepEqual(decls.map(simplifyDecl), [
      { type: 'module.exports', name: 'a', ast: 'Property' },
      { type: 'module.exports', name: 'b', ast: 'Property' }
    ]);
  });

  it('should bailout on dynamic keys in `module.exports`', () => {
    analyzer.run(parse(`
      module.exports = {
        [a]: 1,
        "b": 2
      };
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 8, line: 3 },
          end: { column: 14, line: 3 }
        },
        source: null,
        reason: 'Dynamic `module.exports` property',
        level: 'warning'
      }
    ]);
  });

  it('should not support simultaneous `module.exports` and `exports`', () => {
    analyzer.run(parse(`
      exports.c = 1;
      module.exports = {
        a: 2,
        b: 3
      };
    `), 'root');

    analyzer.run(parse(`
      module.exports = {
        a: 2,
        b: 3
      };
      exports.c = 1;
    `), 'rev-root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: [ {
        loc: {
          start: { column: 6, line: 3 },
          end: { column: 7, line: 6 }
        },
        source: null,
        reason: 'Simultaneous assignment to both `exports` and ' +
                '`module.exports`',
        level: 'warning'
      } ],
      uses: [],
      declarations: [ 'c', 'a', 'b' ]
    });

    assert.deepEqual(analyzer.getModule('rev-root').getInfo(), {
      bailouts: [ {
        loc: {
          start: { column: 6, line: 6 },
          end: { column: 19, line: 6 }
        },
        source: null,
        reason: 'Simultaneous assignment to both `exports` and ' +
                '`module.exports`',
        level: 'warning'
      } ],
      uses: [],
      declarations: [ 'a', 'b', 'c' ]
    });
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
        reason: 'Dynamic CommonJS export',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: 'Dynamic `module` use',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should bailout on dynamic self-use', () => {
    analyzer.run(parse(`
      exports[Math.random()]();
      module.exports[Math.random()]();
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 2 },
          end: { column: 28, line: 2 }
        },
        source: null,
        reason: 'Dynamic CommonJS use',
        level: 'warning'
      },
      {
        loc: {
          start: { column: 6, line: 3 },
          end: { column: 35, line: 3 }
        },
        source: null,
        reason: 'Dynamic CommonJS use',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: 'Dynamic CommonJS import',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: 'Module property assignment',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
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
        reason: 'Escaping value or unknown use',
        level: 'warning'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should bailout on imported library call', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      lib();
    `), 'root');

    analyzer.run(parse(''), 'a');
    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 4 },
          end: { column: 11, line: 4 }
        },
        source: 'root',
        reason: 'Imported library call',
        level: 'info'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should bailout on imported library new call', () => {
    analyzer.run(parse(`
      const lib = require('./a');

      new lib();
    `), 'root');

    analyzer.run(parse(''), 'a');
    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 6, line: 4 },
          end: { column: 15, line: 4 }
        },
        source: 'root',
        reason: 'Imported library new call',
        level: 'info'
      }
    ]);
    assert.deepEqual(analyzer.bailouts, false);
  });

  it('should bailout on deferred require', () => {
    analyzer.run(parse(`
      var lib;
      lib = require('./a');

      lib.a();
      lib.b();
    `), 'root');

    analyzer.run(parse(`
      exports.a = 1;
      exports.b = 2;
      exports.c = 3;
    `), 'a');

    analyzer.resolve('root', './a', 'a');

    assert.deepEqual(analyzer.getModule('root').getInfo(), EMPTY);
    assert.deepEqual(analyzer.getModule('a').getInfo().bailouts, [
      {
        loc: {
          start: { column: 12, line: 3 },
          end: { column: 26, line: 3 }
        },
        source: 'root',
        reason: 'Escaping `require` call',
        level: 'warning'
      }
    ]);
  });

  it('should not bailout on const require argument', () => {
    analyzer.run(parse(`
      const lib = require('./a' + 'b');

      lib.a();
    `), 'root');

    analyzer.run(parse('exports.a = 1;'), 'ab');
    analyzer.resolve('root', './ab', 'ab');

    assert.deepEqual(analyzer.getModule('ab').getInfo(), {
      bailouts: false,
      declarations: [ 'a' ],
      uses: [ 'a' ]
    });
    assert(analyzer.isSuccess());
  });

  it('should not fail on dynamic import', () => {
    assert.doesNotThrow(() => {
      analyzer.run(parse('import("ohai")'), 'root');
    });
  });

  it('should not throw on double-resolve', () => {
    assert.doesNotThrow(() => {
      analyzer.resolve('root', './a', 'a');
      analyzer.resolve('root', './a', 'a');
      analyzer.resolve('root', './a', 'a');
    });
  });

  it('should find recursive dependencies', () => {
    analyzer.run(parse(`
      const lib = require('./a');
      const mlib = require('./ma');

      exports.a = lib.a;
      exports.b = mlib.a;
    `), 'root');

    analyzer.run(parse(`
      exports.a = require('./b').a;
      exports.c = require('./b').b;
      exports.b = exports.c;
    `), 'a');

    analyzer.run(parse(`
      module.exports = {
        a: require('./mb').a,
        b: require('./mb').b
      };
    `), 'ma');

    analyzer.getModule('root').forceExport();

    analyzer.resolve('root', './a', 'a');
    analyzer.resolve('root', './ma', 'ma');
    analyzer.resolve('a', './b', 'b');
    analyzer.resolve('ma', './mb', 'mb');

    assert.deepEqual(analyzer.getModule('a').getInfo(), {
      bailouts: false,
      uses: [ 'a' ],
      declarations: [ 'a', 'c', 'b' ]
    });

    assert.deepEqual(analyzer.getModule('b').getInfo(), {
      bailouts: false,
      uses: [ 'a' ],
      declarations: []
    });

    assert.deepEqual(analyzer.getModule('ma').getInfo(), {
      bailouts: false,
      uses: [ 'a' ],
      declarations: [ 'a', 'b' ]
    });

    assert.deepEqual(analyzer.getModule('mb').getInfo(), {
      bailouts: false,
      uses: [ 'a' ],
      declarations: []
    });
  });

  it('should not choke on async/await', () => {
    assert.doesNotThrow(() => {
      analyzer.run(parse(`
        'use strict';

        const fn = async function() {
          await other();
        };
      `), 'root');
    });
  });

  it('should shake out unused recursive functions', () => {
    analyzer.run(parse(`
      exports.b = function (a) {
        if (a) exports.b(false);
      };
      exports.c = function () {
        return exports.d();
      };
      exports.d = function () {
        return exports.c;
      };
    `), 'root');

    assert.deepEqual(analyzer.getModule('root').getInfo(), {
      bailouts: false,
      uses: [],
      declarations: [ 'b', 'c', 'd' ]
    });
  });

  it('should shake out exports that are only used by unused functions', () => {
    analyzer.run(parse(`
      const util = require('util');

      util.inherits(A, B);
    `), 'app');

    analyzer.run(parse(`
      exports.inherits = function () {};
      exports.debuglog = function () {};
      exports.format = function () {
        exports.debuglog();
      };
    `), 'util');

    analyzer.resolve('app', 'util', 'util');

    assert.deepEqual(analyzer.getModule('util').getInfo(), {
      bailouts: false,
      uses: [ 'inherits' ],
      declarations: [ 'inherits', 'debuglog', 'format' ]
    });
  });
});
