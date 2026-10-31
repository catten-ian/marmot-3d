#!/usr/bin/env python3
"""Patch only runtime-Y translations of grounded GLB nodes using real ground BVH.

The input is read-only. A sibling output GLB and JSON audit log are written.
All geometry is sampled after Blender imports the GLB, avoiding assumptions
about glTF TRS decomposition. The patch edits glTF node translations directly,
so vertex data, materials and texture payloads remain byte-identical.
"""
from __future__ import annotations
import argparse, json, math, struct, sys
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CONTACT=('tree','trunk','root','boulder','rock','stone','shrub','fallen_log','island')
DECOR=('leaves','branch','ivy','foliage','grass','sand','ground','cliff')

def args():
 av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
 p=argparse.ArgumentParser();p.add_argument('--glb',required=True);p.add_argument('--out',required=True);p.add_argument('--report',required=True);p.add_argument('--ground-object',default='ground');p.add_argument('--threshold',type=float,default=.15);p.add_argument('--target-embed',type=float,default=.03);p.add_argument('--backdrop-distance',type=float,default=8.0);p.add_argument('--backdrop-center',type=float,default=40.0);p.add_argument('--source-audit',default=None);return p.parse_args(av)

def chunks(data):
 if data[:4]!=b'glTF': raise ValueError('not a GLB file')
 version,total=struct.unpack_from('<II',data,4); pos=12; out=[]
 while pos<total:
  n,t=struct.unpack_from('<II',data,pos);pos+=8;out.append((t,data[pos:pos+n]));pos+=n
 if version!=2 or pos!=total: raise ValueError('invalid GLB v2 length/chunks')
 return out

def encode_glb(parts):
 body=bytearray()
 for typ,payload in parts:
  pad=(-len(payload))%4
  if typ==0x4E4F534A: payload=payload+b' '*pad
  else: payload=payload+b'\0'*pad
  body+=struct.pack('<II',len(payload),typ)+payload
 return b'glTF'+struct.pack('<II',2,12+len(body))+body

def runtime_points(obj,dg):
 ev=obj.evaluated_get(dg); me=ev.to_mesh()
 try: ps=[ev.matrix_world@v.co for v in me.vertices]
 finally:ev.to_mesh_clear()
 if not ps: ps=[obj.matrix_world@Vector(c) for c in obj.bound_box]
 return [Vector((p.x,p.z,-p.y)) for p in ps]

def audit(scene, ground, threshold, backdrop_distance, backdrop_center):
 dg=bpy.context.evaluated_depsgraph_get(); ev=ground.evaluated_get(dg); me=ev.to_mesh()
 try:
  vs=[ev.matrix_world@v.co for v in me.vertices]; fs=[[int(i) for i in f.vertices] for f in me.polygons]
  bvh=BVHTree.FromPolygons(vs,fs,all_triangles=False)
 finally:ev.to_mesh_clear()
 gpts=runtime_points(ground,dg); gx0=min(p.x for p in gpts);gx1=max(p.x for p in gpts);gz0=min(p.z for p in gpts);gz1=max(p.z for p in gpts)
 playable={'minX':gx0,'maxX':gx1,'minZ':gz0,'maxZ':gz1}; rows=[]
 for o in sorted([x for x in scene.objects if x.type=='MESH'],key=lambda x:x.name):
  pts=runtime_points(o,dg); mn=[min(p[i] for p in pts) for i in range(3)];mx=[max(p[i] for p in pts) for i in range(3)]; center=[(mn[i]+mx[i])/2 for i in range(3)]
  dx=max(playable['minX']-mx[0],0,mn[0]-playable['maxX']);dz=max(playable['minZ']-mx[2],0,mn[2]-playable['maxZ']);dist=math.hypot(dx,dz);center_dist=math.hypot(center[0]-(gx0+gx1)/2,center[2]-(gz0+gz1)/2)
  n=o.name.lower(); remote_semantic=n.startswith('background_cliff') or n=='background_water' or any(k in n for k in ('island_tree','jacaranda','tree_small_02')) and ('background' in n or n.startswith(('island_tree','jacaranda')))
  remote=remote_semantic and (dist>=backdrop_distance or center_dist>=backdrop_center)
  if o.name==ground.name: category='terrain';basis='reference walkable ground mesh'
  elif n.startswith(('shadow','bacground_ground')): category='excluded_artifact';basis='known near-scene shadow/slab artifact'
  elif remote: category='backdrop';basis=f'remote semantic mesh; bounds distance {dist:.2f}m, center distance {center_dist:.2f}m'
  elif n=='background_water': category='near_background';basis='water surface without remote-distance evidence'
  elif any(k in n for k in ('leaves','branch','ivy')) and not any(k in n for k in ('root','trunk','dead_tree')): category='decorative_noncontact';basis='canopy/branch component; contact proxy separate'
  elif any(k in n for k in CONTACT): category='grounded';basis='playable contact-name mesh; no backdrop exemption'
  else: category='grounded_candidate';basis='visible mesh requires contact-role review'
  cx=(mn[0]+mx[0])/2;cz=(mn[2]+mx[2])/2
  hit=bvh.ray_cast(Vector((cx,-cz,10000)),Vector((0,0,-1)),20000)
  support=None if hit[0] is None else float(hit[0].z)
  support_src='aabb_bottom_center'
  if support is None:
   zmin=min(p.z for p in pts);zmax=max(p.z for p in pts);eps=max(.012,(zmax-zmin)*.01);bottom=[p for p in pts if p.z<=zmin+eps]
   vals=[]
   for p in bottom:
    h=bvh.ray_cast(Vector((p.x,-p.z,10000)),Vector((0,0,-1)),20000)
    if h[0] is not None: vals.append(float(h[0].z))
   if vals: vals.sort();support=vals[len(vals)//2];support_src='median_actual_bottom_vertex_hits'
   else: support_src='no_ground_triangle_hit'
  gap=None if support is None else float(mn[1]-support)
  evidence={'distanceToPlayableBoundsMeters':dist,'distanceToPlayableCenterMeters':center_dist,'fogFarMeters':175.0,'behindFogFar':center_dist>175,'remoteDistanceThresholdMeters':backdrop_distance,'remoteCenterDistanceThresholdMeters':backdrop_center} if category=='backdrop' else None
  status='not_applicable' if category!='grounded' else 'no_ground_hit' if gap is None else 'floating' if gap>threshold else 'embedded' if gap < -threshold else 'grounded'
  rows.append({'name':o.name,'category':category,'classificationBasis':basis,'bbox':{'min':mn,'max':mx},'bboxMinY':mn[1],'groundYBelow':support,'gap':gap,'groundSupportSource':support_src,'footprintRadius':.5*math.hypot(mx[0]-mn[0],mx[2]-mn[2]),'distanceToPlayableMeters':dist,'distanceToPlayableCenterMeters':center_dist,'backdropEvidence':evidence,'groundingStatus':status,'deltaY':0.0})
 return rows,playable

def node_map(j):
 out={}
 for i,n in enumerate(j.get('nodes',[])):
  if n.get('name'): out.setdefault(n['name'],[]).append((i,n))
 return out

def main():
 a=args();src=Path(a.glb).resolve();out=Path(a.out).resolve();report=Path(a.report).resolve()
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(src));bpy.context.view_layer.update()
 ground=bpy.data.objects.get(a.ground_object)
 if not ground or ground.type!='MESH':raise SystemExit('ground mesh missing')
 before,playable=audit(bpy.context.scene,ground,a.threshold,a.backdrop_distance,a.backdrop_center)
 source_roles={}
 if a.source_audit:
  src_report=json.loads(Path(a.source_audit).read_text(encoding='utf8'))
  source_roles={r['name']:r for r in src_report.get('meshes',[])}
  for row in before:
   source_row=source_roles.get(row['name'])
   if source_row:
    row['category']=source_row['category'];row['classificationBasis']='source blend role: '+source_row['classificationBasis']
 raw=src.read_bytes();parts=chunks(raw);j=json.loads(next(d for t,d in parts if t==0x4E4F534A));by_name=node_map(j);changes=[]
 for r in before:
  if r['category']!='grounded' or r['gap'] is None or r['gap']<=a.threshold:continue
  matches=by_name.get(r['name'],[])
  if len(matches)!=1: raise SystemExit(f"expected one glTF node for {r['name']}; found {len(matches)}")
  idx,node=matches[0]; delta=a.target_embed-r['gap']
  if 'translation' in node:
   tr=list(node['translation']);tr[1]+=delta;node['translation']=tr
  elif 'matrix' in node:
   mat=list(node['matrix']);mat[13]+=delta;node['matrix']=mat
  else:
   tr=list(node.get('translation',[0,0,0]));tr[1]+=delta;node['translation']=tr
  changes.append({'name':r['name'],'nodeIndex':idx,'gapBefore':r['gap'],'groundYBelow':r['groundYBelow'],'bboxMinYBefore':r['bboxMinY'],'deltaY':delta,'targetEmbedMeters':a.target_embed})
 jdata=json.dumps(j,separators=(',',':'),ensure_ascii=False).encode('utf8');parts=[(t,jdata if t==0x4E4F534A else d) for t,d in parts];out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(encode_glb(parts))
 # Verify the patched node positions by re-importing the immutable output.
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(out));bpy.context.view_layer.update();ground=bpy.data.objects.get(a.ground_object)
 after,playable=audit(bpy.context.scene,ground,a.threshold,a.backdrop_distance,a.backdrop_center)
 after_map={r['name']:r for r in after}
 for c in changes:
  r=after_map[c['name']];c.update({'gapAfter':r['gap'],'bboxMinYAfter':r['bboxMinY'],'groundYBelowAfter':r['groundYBelow'],'verified':r['gap'] is not None and r['gap']<=a.threshold})
 result={'format':1,'input':str(src),'output':str(out),'algorithm':'post-export GLB node-Y translation, actual GLB ground BVH; mesh/binary/material payload preserved','thresholdMeters':a.threshold,'targetEmbedMeters':a.target_embed,'playableBounds':playable,'meshCountBefore':len(before),'changes':changes,'meshCountAfter':len(after),'summary':{'groundedTotal':sum(r['category']=='grounded' for r in after),'groundedPositiveGapPass':sum(r['category']=='grounded' and r['gap'] is not None and r['gap']<=a.threshold for r in after),'groundedNoGroundHit':sum(r['category']=='grounded' and r['gap'] is None for r in after),'backdropTotal':sum(r['category']=='backdrop' for r in after),'backdropWithDistanceEvidence':sum(r['category']=='backdrop' and r['backdropEvidence'] is not None for r in after)},'before':before,'after':after}
 report.parent.mkdir(parents=True,exist_ok=True);report.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8');print(json.dumps({'output':str(out),'changes':len(changes),'summary':result['summary']},ensure_ascii=False,indent=2))
 if any(not c['verified'] for c in changes):raise SystemExit('post-patch verification failed')
if __name__=='__main__':main()
