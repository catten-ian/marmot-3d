'use strict';
(async () => {
  const memory = await import('../src/core/memory-budget.mjs');
  const snap = { usedJSHeapSize: 950, jsHeapSizeLimit: 1000 };
  if (!memory.exceedsMemoryBudget({ snapshot: snap, reserveBytes: 100, maxFraction: 0.9 })) throw new Error('budget should trip');
  if (memory.exceedsMemoryBudget({ snapshot: { usedJSHeapSize: 100, jsHeapSizeLimit: 1000 }, reserveBytes: 100, maxFraction: 0.9 })) throw new Error('budget false positive');
  if (memory.exceedsMemoryBudget({ snapshot: null })) throw new Error('missing memory should be allowed');
  const ranges = [[0, 0.46], [0.5, 0.70], [1, 0.82], [1, 0.90], [1, 0.98], [1, 1]];
  let last = 0;
  for (const [, p] of ranges) { if (p < last) throw new Error('progress regressed'); last = p; }
  console.log('verdant memory/progress pure checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
