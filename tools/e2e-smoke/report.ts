import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from './util.ts';
import { allGatesPass } from './stats.ts';
export function finalizeRun(runDir:string, report:any){
  const shotsDir=path.join(runDir,'screenshots');ensureDir(shotsDir);
  fs.writeFileSync(path.join(shotsDir,'manifest.json'),JSON.stringify({target:report.target,device:report.device,viewport:report.viewport,screenshots:report.screenshots},null,2));
  report.pass=allGatesPass(report.gates);
  fs.writeFileSync(path.join(runDir,'run-result.json'),JSON.stringify(report,null,2));
  const lines=[`# E2E Smoke: ${report.target} / ${report.device}`,'',`- 结论：**${report.pass?'PASS':'FAIL'}**`,`- 目标：\`${report.url||'未导航'}\``,`- Chrome PID：${report.chrome?.rootPid??'不可得'}`,`- 设备视口：${report.viewport?.width}×${report.viewport?.height} CSS px; DPR ${report.viewport?.deviceScaleFactor}`,`- 导航起点：${report.timings.navigationStart||'不可得'}`,`- 标题按钮发现：${report.timings.titleButtonFirstDetected||'不可得'}`,`- 页面 ready/首帧：${report.timings.bootReadyAt||'不可得'} / ${report.timings.firstFrameAt||'不可得'}`,`- 档位：${JSON.stringify(report.tier)}`,'','## 闸门'];
  for(const [key,value] of Object.entries(report.gates) as Array<[string,any]>)lines.push(`- ${value.pass?'✅':'❌'} ${key}: ${JSON.stringify(value.evidence)}`);
  lines.push('','## 性能');lines.push(`- CPU 阶段摘要：\`${JSON.stringify(report.cpu)}\``);lines.push(`- 内存摘要：\`${JSON.stringify(report.memory.summary)}\``);lines.push(`- GPU / 后端：\`${JSON.stringify(report.backend)}\``);lines.push(`- 静置 RAF：\`${JSON.stringify(report.frameRate.idle)}\``);lines.push(`- 移动 RAF：\`${JSON.stringify(report.frameRate.movement)}\``);lines.push('','## 控制台与错误',`- 分级计数：\`${JSON.stringify(report.console.counts)}\``,`- 致命错误：\`${JSON.stringify(report.console.fatalErrors)}\``,'','## 截图');for(const shot of report.screenshots)lines.push(`- ${shot.node}: \`${shot.file}\` (${shot.ts})`);lines.push('','## 清理',`- 证据：\`${JSON.stringify(report.cleanup)}\``,'','详细时序/采样/事件见同目录 `run-result.json`。');
  fs.writeFileSync(path.join(runDir,'report.md'),`${lines.join('\n')}\n`);
  return report.pass;
}
