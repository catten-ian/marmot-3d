export function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
export function summarizeFrames(dts: number[]) {
  const mean = dts.length ? dts.reduce((a,b)=>a+b,0)/dts.length : null;
  return {
    sampleCount:dts.length, dtMs:dts,
    meanDtMs:mean,
    p50DtMs:percentile(dts,.50), p95DtMs:percentile(dts,.95), p99DtMs:percentile(dts,.99), maxDtMs:percentile(dts,1),
    over50ms:dts.filter((dt)=>dt>50).length,
    averageFps:mean && mean>0 ? 1000/mean : null,
  };
}
export function allGatesPass(gates: Record<string,{pass:boolean}>) { return Object.values(gates).length>0 && Object.values(gates).every((gate)=>gate.pass); }
export function summarizeMetricDeltas(samples: Array<{metricDeltas?:Record<string,number|null>}>) {
  const names = ['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'];
  const sums:Record<string,number> = Object.fromEntries(names.map((x)=>[x,0]));
  for (const sample of samples) for (const name of names) sums[name] += Math.max(0, sample.metricDeltas?.[name] || 0);
  const task = sums.TaskDuration;
  return { seconds:sums, ratiosOfTask:task>0?{script:sums.ScriptDuration/task,layout:sums.LayoutDuration/task,recalcStyle:sums.RecalcStyleDuration/task}:null };
}
