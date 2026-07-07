const assert = require('assert');

require('../packages.js');
const { calculateScore } = require('../classifier.js');

assert.strictEqual(calculateScore('Study With Me 4 Hours', 'study'), 20);
assert.strictEqual(calculateScore('Minecraft speedrun', 'study'), -20);
assert.strictEqual(calculateScore('Workout routine for beginners', 'workout'), 10);
assert.strictEqual(calculateScore('React project tutorial', 'development'), 10);
assert.strictEqual(calculateScore('Deep work and focus session', 'study'), 20);

console.log('classifier tests passed');
