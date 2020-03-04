const path = require('path');
const callsites = require('callsites');

function decorate(consoleLevel, bunyanFn) {
  console[consoleLevel] = (...args) => {
    const callsite = callsites()[1];
    const origin = `at ${path.relative(process.cwd(), callsite.getFileName())}:${callsite.getLineNumber()}`;
    bunyanFn({ event: 'USER_LOG' }, origin, '\n', ...args);
  };
  return this;
}

module.exports = {
  decorate,
};
