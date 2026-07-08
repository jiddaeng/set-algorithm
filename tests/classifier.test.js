const assert = require('assert');

require('../packages.js');
const { calculateScore, shouldKeepContent } = require('../classifier.js');

assert.strictEqual(calculateScore('Study With Me 4 Hours', 'study'), 20);
assert.strictEqual(calculateScore('Minecraft speedrun', 'study'), -20);
assert.strictEqual(calculateScore('Workout routine for beginners', 'workout'), 10);
assert.strictEqual(calculateScore('React project tutorial', 'development'), 30);
assert.strictEqual(calculateScore('Deep work and focus session', 'study'), 20);
assert.strictEqual(shouldKeepContent('Cute science cartoon for kids', 'kids', null, 'blocklist'), true);
assert.strictEqual(shouldKeepContent('Scary horror prank for kids', 'kids', null, 'blocklist'), false);
assert.strictEqual(shouldKeepContent('Random vlog', 'kids', null, 'allowlist'), false);
assert.strictEqual(shouldKeepContent('Science story for children', 'kids', null, 'allowlist'), true);

console.log('classifier tests passed');
