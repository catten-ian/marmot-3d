import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const iso = () => new Date().toISOString();
export const round = (n: number, places = 4) => Number.isFinite(n) ? Number(n.toFixed(places)) : null;
export function ensureDir(dir: string) { fs.mkdirSync(dir, { recursive: true }); }
export async function freePort(preferred: number, attempts = 40): Promise<number> {
  for (let port = preferred; port < preferred + attempts; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close((err) => err ? reject(err) : resolve()));
      });
      return port;
    } catch { /* Try the next uncommon ephemeral port. */ }
  }
  throw new Error(`No available port in ${preferred}-${preferred + attempts - 1}`);
}
export async function portListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(400, () => { socket.destroy(); resolve(false); });
  });
}
export function createProfileDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'm3d-e2e-smoke-')); }
export function readChromeTree(rootPid: number) {
  const parents = new Map<number, { pid:number; ppid:number; cpuTicks:number; cmd:string }>();
  let entries: string[] = [];
  try { entries = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)); } catch { return { pids:[],gpuPids:[],rssBytes:0,cpuTicks:0,groups:{} as any }; }
  for (const entry of entries) {
    const pid=Number(entry);
    try { const text=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const end=text.lastIndexOf(')');const fields=text.slice(end+2).split(/\s+/);const cmd=fs.readFileSync(`/proc/${pid}/cmdline`,'utf8');parents.set(pid,{pid,ppid:Number(fields[1]),cpuTicks:Number(fields[11]||0)+Number(fields[12]||0),cmd}); } catch {}
  }
  const pids=new Set<number>([rootPid]);let changed=true;
  while(changed){changed=false;for(const row of parents.values())if(pids.has(row.ppid)&&!pids.has(row.pid)){pids.add(row.pid);changed=true;}}
  const groups:Record<string,{pids:number[];rssBytes:number;cpuTicks:number}>={browser:{pids:[],rssBytes:0,cpuTicks:0},renderer:{pids:[],rssBytes:0,cpuTicks:0},gpu:{pids:[],rssBytes:0,cpuTicks:0},other:{pids:[],rssBytes:0,cpuTicks:0}};
  let rssBytes=0,cpuTicks=0;const gpuPids:number[]=[];
  for(const pid of pids){const row=parents.get(pid);if(!row)continue;let rss=0;try{rss=Number(fs.readFileSync(`/proc/${pid}/status`,'utf8').match(/^VmRSS:\s+(\d+)/m)?.[1]||0)*1024;}catch{};cpuTicks+=row.cpuTicks;rssBytes+=rss;const role=row.cmd.includes('--type=renderer')?'renderer':row.cmd.includes('--type=gpu-process')?'gpu':pid===rootPid?'browser':'other';const group=groups[role];group.pids.push(pid);group.cpuTicks+=row.cpuTicks;group.rssBytes+=rss;if(role==='gpu')gpuPids.push(pid);}
  return {pids:[...pids],gpuPids,rssBytes,cpuTicks,groups};
}
export function clockTicksPerSecond() {
  const r = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 });
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : 100;
}
export function safeRmProfile(profile: string | undefined) {
  if (!profile || !profile.startsWith(path.join(os.tmpdir(), 'm3d-e2e-smoke-'))) return false;
  fs.rmSync(profile, { recursive: true, force: true });
  return !fs.existsSync(profile);
}
