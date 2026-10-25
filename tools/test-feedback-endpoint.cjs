const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('src/core/feedback-endpoint.mjs', 'utf8')
  .replace(/^export\s+/gm, '')
  + '\nmodule.exports = { deriveFeedbackEndpoint };';
const sandbox = { module: { exports: {} }, exports: {}, URLSearchParams };
vm.runInNewContext(source, sandbox, { filename: 'feedback-endpoint.mjs' });
const { deriveFeedbackEndpoint } = sandbox.module.exports;
assert.strictEqual(deriveFeedbackEndpoint({ protocol: 'https:', pathname: '/marmot3d-beta/', search: '' }), '/marmot3d-beta/api/feedback');
assert.strictEqual(deriveFeedbackEndpoint({ protocol: 'https:', pathname: '/marmot3d/', search: '' }), '/marmot3d/api/feedback');
assert.strictEqual(deriveFeedbackEndpoint({ protocol: 'https:', pathname: '/', search: '?version=beta' }), '/marmot3d-beta/api/feedback');
assert.strictEqual(deriveFeedbackEndpoint({ protocol: 'https:', pathname: '/', search: '?version=dev' }), '/marmot3d/api/feedback');
assert.strictEqual(deriveFeedbackEndpoint({ protocol: 'file:', pathname: '/tmp/index.html', search: '' }), '/marmot3d/api/feedback');
console.log('feedback endpoint tests passed');
