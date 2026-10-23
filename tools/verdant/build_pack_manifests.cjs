#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]||'assets/verdant');
function sha(file){const h=crypto.createHash('sha256');h.update(fs.readFileSync(file));return h.digest('hex')}
function md5(file){const h=crypto.createHash('md5');h.update(fs.readFileSync(file));return h.digest('hex')}
function walk(dir){const out=[];for(const name of fs.readdirSync(dir)){const p=path.join(dir,name),s=fs.statSync(p);if(s.isDirectory())out.push(...walk(p));else out.push(p)}return out}
for(const tier of ['low','medium','high','ultra']){
 const dir=path.join(root,'tiers',tier), files=walk(dir).filter(p=>!p.endsWith('pack-manifest.json'));
 const entries=files.map(file=>({path:path.relative(dir,file).replaceAll(path.sep,'/'),size:fs.statSync(file).size,sha256:sha(file),md5:md5(file),contentType:file.endsWith('.gltf')?'model/gltf+json':file.endsWith('.bin')?'application/octet-stream':file.endsWith('.json')?'application/json':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.hdr')?'image/vnd.radiance':'image/png'}));
 const total=entries.reduce((n,x)=>n+x.size,0); const out={format:1,pack:`m3d-dev/20261022/${tier}`,tier,generatedAt:'2026-10-22',totalBytes:total,fileCount:entries.length,files:entries};
 fs.writeFileSync(path.join(dir,'pack-manifest.json'),JSON.stringify(out,null,2)+'\n');
 const m=JSON.parse(fs.readFileSync(path.join(dir,`manifest-${tier}.json`)));m.packManifest='pack-manifest.json';m.stats.packBytes=total;m.stats.packFileCount=entries.length;m.stats.fileSha256=sha(path.join(dir,m.files.scene));fs.writeFileSync(path.join(dir,`manifest-${tier}.json`),JSON.stringify(m,null,2)+'\n');
 console.log(tier,total,entries.length)
}
