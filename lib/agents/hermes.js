'use strict';

const fs = require('fs');
const runtimePath = require('../runtime-path');
const ConsoleAgent = require('../ConsoleAgent');

const errorRe1 = /^(\w+): (.*)$/m;
const errorRe2 = /^(?:(\w+): (.*))|(?:(\w+))$/m;

function parseSyntaxError(syntaxErrorMessage) {
  const matches = syntaxErrorMessage.match(/:(\d+):(\d+): (.*)/);
  if (matches && matches.length) {
    return {
      message: matches[3].replace('error: ', ''),
      lineNumber: Number(matches[1]),
      columnNumber: Number(matches[2])
    };
  }
  return null;
}


class HermesAgent extends ConsoleAgent {
  constructor(options) {
    super(options);
  }

  async evalScript(code, options = {}) {
    // By default eshost must target an environment that can
    // evaluate non-strict mode code
    if (!options.module) {
      this.args.unshift('-non-strict');
    }

    // Hermes version 0.10.0 introduced `-Xenable-tdz` to replace `-fenable-tdz`.
    // https://github.com/facebook/hermes/commit/f811a0e75f19ab0da7dcf969a61db894fbb3cc35
    let tdzArg = '-Xenable-tdz'; 
    try {
      const cp = await this.createChildProcess(['-version']);
      let stdout = '';
      cp.stdout.on('data', str => { stdout += str; });
      await new Promise(resolve => { cp.on('close', resolve); });
      // https://github.com/facebook/hermes/blob/66d3f87a8fd0436634be8a1049a1db9d3aa6e9c0/lib/CompilerDriver/CompilerDriver.cpp#L2164
      const [_, version] = /Hermes release version: (.*)/.exec(stdout);
      if (/^0[.][0-9][.]/.test(version)) {
        tdzArg = '-fenable-tdz';
      }
    } catch (error) {
      // suppressed
    }
    this.args.unshift('-Xintl', '-enable-eval', tdzArg);

    // There is currently no flag for supporting modules in Hermes
    // if (options.module && this.args[0] !== '-m') {
    //   this.args.unshift('-m');
    // }

    // if (!options.module && this.args[0] === '-m') {
    //   this.args.shift();
    // }

    return super.evalScript(code, options);
  }

  parseError(rawstr) {
    const str = rawstr.replace(/^Uncaught /, '');

    let match = str.match(errorRe1);

    if (match) {
      return {
        name: match[1],
        message: match[2],
        stack: [],
      };
    } else {

      // Syntax errors don't have nice error messages...
      let error = null;
      let errors = str.match(/:(\d+):(\d+): (.*)/gm);

      if (errors && errors.length) {
        error = {
          name: 'SyntaxError',
          message: '',
          stack: []
        };

        const stack = parseSyntaxError(errors[0]);

        if (stack) {
          error.stack.push(stack);
          error.message = stack.message;
        }
      }

      if (error) {
        return error;
      }

      // Last chance...
      errors = str.match(errorRe2);

      if (errors && errors[0]) {
        return {
          name: errors[0],
          message: errors[1],
          stack: [],
        };
      }
    }

    return null;
  }
}
HermesAgent.runtime = fs.readFileSync(runtimePath.for('hermes'), 'utf8');

module.exports = HermesAgent;
