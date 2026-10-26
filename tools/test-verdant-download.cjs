const test = require('node:test');
const assert = require('node:assert/strict');
test('md5 vectors and byte progress include skipped files', async () => {
  const { md5Hex, createByteProgress, recordPackFileDone, byteProgressFraction, shouldSkipPackFile } = await import('../src/world/verdant-download.mjs');
  assert.equal(md5Hex(new TextEncoder().encode('abc')), '900150983cd24fb0d6963f7d28e17f72');
  const records = [{ size: 10, md5: 'a' }, { size: 30, md5: 'b' }];
  const progress = createByteProgress(records);
  assert.equal(progress.total, 40);
  assert.equal(shouldSkipPackFile({ existingSize: 10, existingHash: 'A', record: records[0] }), true);
  recordPackFileDone(progress, 10, { skipped: true });
  assert.equal(progress.done, 10); assert.equal(progress.skipped, 1); assert.equal(byteProgressFraction(progress), 0.25);
  recordPackFileDone(progress, 30);
  assert.equal(byteProgressFraction(progress), 1);
});
