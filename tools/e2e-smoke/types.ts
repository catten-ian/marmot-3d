export type Target = 'official' | 'local';
export type Device = 'desktop' | 'mobile';
export interface Config {
  target: Target;
  device: Device;
  loadWaitMs: number;
  settleMs: number;
  moveMs: number;
  outputDir: string;
  staticPort?: number;
  cdpPort?: number;
  globalTimeoutMs: number;
  /** 第一段等待预算（等待进入沙盒就绪）。null = 未显式指定。 */
  settleInMs: number | null;
  /** 第二段等待预算（就绪后静置）。null = 未显式指定。 */
  settleAfterMs: number | null;
}
export interface Gate { pass: boolean; evidence: unknown; }
export interface Sample {
  ts: string;
  elapsedMs: number;
  phase: string;
  pageMetrics?: Record<string, number | null>;
  metricDeltas?: Record<string, number | null>;
  metricRatios?: Record<string, number | null>;
  heap?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } | null;
  chrome?: { pids: number[]; gpuPids: number[]; rssBytes: number; cpuTicks: number; cpuPercent: number | null };
}
