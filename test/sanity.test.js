// test/sanity.test.js
const assert = require('assert');

function add(a, b) {
  return a + b;
}

// Sample passing Test
assert.strictEqual(add(1, 1), 2, "add(1, 1) should equal 2");

console.log("All tests passed!");
