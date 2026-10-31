#!/usr/bin/env python3
"""Compare Blender dump runtime transforms with exported GLB node world transforms."""
import argparse, json, struct
from pathlib import Path
import numpy as np

def glb_json(path):
    b=Path(path).read_bytes(); n,typ=struct.unpack_from('<II',b,12); return json.loads(b[20:20+n])
def local_matrix(node):
    if 'matrix' in node: return np.array(node['matrix'],float).reshape(4,4).T
    t=np.eye(4); t[:3,3]=node.get('translation',[0,0,0]); s=np.diag(node.get('scale',[1,1,1])+[1]);
    # rotation quaternion x,y,z,w
    x,y,z,w=node.get('rotation',[0,0,0,1]); r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
    m=np.eye(4);m[:3,:3]=r@s[:3,:3];m[:3,3]=t[:3,3];return m

def main():
 p=argparse.ArgumentParser();p.add_argument('--dump',required=True);p.add_argument('--glb',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 dump=json.loads(Path(a.dump).read_text()); glb=glb_json(a.glb); nodes=glb['nodes']; parents={c:i for i,n in enumerate(nodes) for c in n.get('children',[])}; worlds={}
 def world(i):
  if i in worlds:return worlds[i]
  m=local_matrix(nodes[i]); worlds[i]=world(parents[i])@m if i in parents else m; return worlds[i]
 rows=[]; names={'main_dead_tree_trunk','dead_tree_trunk_02','dead_tree_trunk_02.002','dead_tree_trunk.001','tree_small_02_a','tree_small_02_b','tree_small_02_c','island_tree_01_a','island_tree_01_b','jacaranda_tree_trunk','jacaranda_tree_branches','coastal_cliff_02_LOD1.001','coastal_cliff_02_LOD1.002','coastal_cliff_04_LOD1.001','coastal_cliff_04_LOD1.002'}
 src={m['name']:m for m in dump['meshes']}
 for i,n in enumerate(nodes):
  name=n.get('name','');
  if name not in names or name not in src: continue
  runtime=np.array(src[name]['runtimeExpectedMatrix'],float); conv=np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]],float); expected=conv@runtime; actual=world(i); dp=float(np.linalg.norm(expected[:3,3]-actual[:3,3])); rows.append({'name':name,'parent':nodes[parents[i]].get('name') if i in parents else None,'blendMappedGlbTranslation':expected[:3,3].round(5).tolist(),'glbWorldTranslation':actual[:3,3].round(5).tolist(),'translationError':round(dp,6),'match':dp<0.01})
 out={'blendDump':a.dump,'glb':a.glb,'rows':rows,'allTranslationsMatch':all(r['match'] for r in rows)};Path(a.out).write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out,indent=2))
if __name__=='__main__':main()
