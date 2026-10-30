/**
 * 等待调度（wait plan）解析。
 *
 * 背景：点击沙盒入口后，页面需要时间完成加载遮罩（#loader）退场。此前工具只有
 * 一个固定的 settle 死线（默认 15000ms），加载慢时会在遮罩仍在的情况下如实判定
 * enteredSandbox 失败。为了让"两段等待"可独立自定义，这里把 settle 阶段拆成：
 *
 *   第一段（stage1 / settle-in）  ：从点击沙盒入口起，等待加载遮罩退场（进入沙盒就绪）的上限。
 *   第二段（stage2 / settle-after）：就绪之后，再固定静置一段时间用于采集稳定的 idle 帧率。
 *
 * 兼容约定：
 *   - 只给 --settle-ms（默认路径）→ 单段模式，行为与旧版逐字一致：固定死线，不提前退出。
 *   - 给了 --settle-in-ms 或 --settle-after-ms 之一 → 两段模式。
 *     未显式给出的那一段使用本文件的默认值（第一段 120000ms，第二段 15000ms）。
 */

export const DEFAULT_LOAD_WAIT_MS = 120000;
export const DEFAULT_SETTLE_MS = 15000;
export const DEFAULT_MOVE_MS = 10000;
export const DEFAULT_SETTLE_IN_MS = 120000;
export const DEFAULT_SETTLE_AFTER_MS = 15000;

export type SettleMode = 'single' | 'two-stage';

export interface SettlePlan {
  /** single = 旧版固定死线；two-stage = 两段独立可配等待。 */
  mode: SettleMode;
  /** 第一段预算（毫秒）。single 模式下即 settleMs。 */
  stage1Ms: number;
  /** 第二段预算（毫秒）。single 模式下恒为 0。 */
  stage2Ms: number;
  /** 两段模式下的最大总时长；single 模式下等于 stage1Ms。 */
  maxTotalMs: number;
}

export interface SettlePlanInput {
  settleMs: number;
  /** null 表示调用方未显式指定。 */
  settleInMs: number | null;
  settleAfterMs: number | null;
}

function assertTiming(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid timing: ${name}=${value}`);
  return value;
}

/**
 * 解析 settle 调度。非法值一律抛错，不做静默兜底。
 */
export function resolveSettlePlan(input: SettlePlanInput): SettlePlan {
  const { settleMs, settleInMs, settleAfterMs } = input;
  assertTiming('settleMs', settleMs);
  if (settleInMs !== null) assertTiming('settleInMs', settleInMs);
  if (settleAfterMs !== null) assertTiming('settleAfterMs', settleAfterMs);

  if (settleInMs === null && settleAfterMs === null) {
    return { mode: 'single', stage1Ms: settleMs, stage2Ms: 0, maxTotalMs: settleMs };
  }
  const stage1Ms = settleInMs ?? DEFAULT_SETTLE_IN_MS;
  const stage2Ms = settleAfterMs ?? DEFAULT_SETTLE_AFTER_MS;
  return { mode: 'two-stage', stage1Ms, stage2Ms, maxTotalMs: stage1Ms + stage2Ms };
}

/**
 * 两段模式下，第一段是否应当"就绪即退出"（而不是耗尽整个预算）。
 * 单段模式永远跑满固定死线，保持旧行为不变。
 */
export function shouldExitStage1Early(mode: SettleMode): boolean {
  return mode === 'two-stage';
}

/**
 * 从命令行实参推出实际生效的等待调度，供 suite 报告如实展示，
 * 避免报告里写死 "120s/15s/10s" 却与实际执行不符。
 */
export function describeSchedule(args: string[]): {
  loadWaitMs: number;
  settleMs: number;
  settleInMs: number | null;
  settleAfterMs: number | null;
  moveMs: number;
  mode: SettleMode;
  stage1Ms: number;
  stage2Ms: number;
} {
  let loadWaitMs = DEFAULT_LOAD_WAIT_MS;
  let settleMs = DEFAULT_SETTLE_MS;
  let settleInMs: number | null = null;
  let settleAfterMs: number | null = null;
  let moveMs = DEFAULT_MOVE_MS;
  for (const arg of args) {
    const [key, value] = arg.split('=', 2);
    const num = Number(value);
    if (key === '--load-wait-ms' && Number.isFinite(num)) loadWaitMs = num;
    else if (key === '--settle-ms' && Number.isFinite(num)) settleMs = num;
    else if (key === '--settle-in-ms' && Number.isFinite(num)) settleInMs = num;
    else if (key === '--settle-after-ms' && Number.isFinite(num)) settleAfterMs = num;
    else if (key === '--move-ms' && Number.isFinite(num)) moveMs = num;
  }
  const plan = resolveSettlePlan({ settleMs, settleInMs, settleAfterMs });
  return { loadWaitMs, settleMs, settleInMs, settleAfterMs, moveMs, mode: plan.mode, stage1Ms: plan.stage1Ms, stage2Ms: plan.stage2Ms };
}
