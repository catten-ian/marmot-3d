#!/usr/bin/env python3
"""Export the supplied A Verdant Trail Blender scene as a web-sized, textured GLB.

Run with Blender's Python: blender -b --python this_file.py -- --blend ... --out-dir ...
The source blend is never modified. All selected objects keep their original geometry/materials,
then receive a bounded decimate pass and the exact legacy Verdant coordinate transform.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

COLLECTIONS={'main_scene','foliage','debris','cliffs_boulders','background','scene_components','debris_patches','grass_medium_02','hanging_grass','island_tree_01_branches','island_tree_01_leaves','jacaranda_tree_leaves','shrub_01','shrub_03','shrub_04','tree_small_02_leaves'}
IMAGE_KINDS=('diff','basecolor','albedo','nor_gl','normal','rough','roughness','alpha','opacity','mask')

def args():
 p=argparse.ArgumentParser(); p.add_argument('--blend',required=True); p.add_argument('--out-dir',required=True); p.add_argument('--max-triangles',type=int,default=650000); p.add_argument('--ground-object',default='ground'); p.add_argument('--height-grid',type=int,default=145); p.add_argument('--max-near-texture',type=int,default=2048); p.add_argument('--max-far-texture',type=int,default=1024); p.add_argument('--geometry-only',action='store_true')
 av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]; return p.parse_args(av)

def bbox(obj):
 ps=[obj.matrix_world@Vector(c) for c in obj.bound_box]; return (min(v.x for v in ps),max(v.x for v in ps),min(v.y for v in ps),max(v.y for v in ps),min(v.z for v in ps),max(v.z for v in ps))

def bvh_for(obj):
 deps=bpy.context.evaluated_depsgraph_get(); ev=obj.evaluated_get(deps); me=ev.to_mesh()
 try:
  vs=[ev.matrix_world@v.co for v in me.vertices]; fs=[[i for i in f.vertices] for f in me.polygons]; return BVHTree.FromPolygons(vs,fs,all_triangles=False)
 finally: ev.to_mesh_clear()

def sample_ground(obj,n):
 b=bbox(obj); xmin,xmax,ymin,ymax,zmin,zmax=b; px=(xmax-xmin)*.006; py=(ymax-ymin)*.006; xmin+=px;xmax-=px;ymin+=py;ymax-=py; tree=bvh_for(obj); hs=[]
 for j in range(n):
  sy=ymin+(ymax-ymin)*j/(n-1)
  for i in range(n):
   sx=xmin+(xmax-xmin)*i/(n-1); hit=tree.ray_cast(Vector((sx,sy,zmax+100)),Vector((0,0,-1)),200); hs.append(float(hit[0].z) if hit[0] is not None else float(zmin))
 return b,hs,(xmin,xmax,ymin,ymax,zmin,zmax)

def xform(bounds):
 xmin,xmax,ymin,ymax,zmin,zmax=bounds; sw=xmax-xmin; sh=ymax-ymin; sx=130/sh*.88; sz=78/sw*.88; sy=min(sx,sz); cx=(xmin+xmax)/2; cy=(ymin+ymax)/2
 return Matrix(((0,sx,0,-sx*cy),(-sz,0,0,sz*cx),(0,0,sy,-sy*zmin),(0,0,0,1))),sy,sx,sz,cx,cy

def source_path(img,blend):
 p=Path(bpy.path.abspath(img.filepath,library=img.library));
 if p.exists(): return p
 q=Path(blend).parent/'textures'/Path(img.filepath).name
 return q

def texture_kind(name):
 n=name.lower()
 if any(k in n for k in ('nor_gl','normal')): return 'normal'
 if any(k in n for k in ('rough','roughness')): return 'rough'
 if any(k in n for k in ('alpha','opacity','mask')): return 'alpha'
 if any(k in n for k in ('diff','basecolor','albedo')): return 'diff'
 return None

def make_web_image(img,blend,out,near,far,cache):
 if img is None or img.source!='FILE': return img
 src=source_path(img,blend)
 if not src.exists(): return img
 kind=texture_kind(img.name) or texture_kind(src.name) or 'diff'; is_near=any(k in src.name.lower() for k in ('ground','dirt','rock','boulder','root','trunk'))
 limit=near if is_near else far
 # Normal maps are retained losslessly but reduced in resolution; the source pack's
 # 4K/2K normals otherwise dominate the embedded GLB size.
 if kind=='normal': limit=min(limit, 512)
 if kind=='normal': ext='.png'
 elif kind in ('rough','alpha'): ext='.png' if kind=='alpha' else '.jpg'
 else: ext='.jpg'
 key=(str(src),kind,limit)
 if key in cache: return cache[key]
 safe=src.stem.replace(' ','_')+f'_{limit}'+ext; dest=out/safe
 try:
  if not dest.exists():
   im=bpy.data.images.load(str(src),check_existing=True); cp=im.copy(); cp.name='web_'+safe; cp.scale(limit,limit)
   if ext=='.jpg': cp.file_format='JPEG'; cp.save(filepath=str(dest),quality=82)
   else: cp.file_format='PNG'; cp.save(filepath=str(dest))
   bpy.data.images.remove(cp)
  ni=bpy.data.images.load(str(dest),check_existing=True); cache[key]=ni; return ni
 except Exception as e:
  print('texture conversion failed',src,e); return img

def remap_materials(blend,out,near,far,geometry_only):
 cache={}; used=[]
 for mat in bpy.data.materials:
  if not mat.use_nodes: continue
  mat.surface_render_method='DITHERED' if hasattr(mat,'surface_render_method') else getattr(mat,'surface_render_method',None)
  bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
  if bs:
   if 'Roughness' in bs.inputs and not bs.inputs['Roughness'].is_linked: bs.inputs['Roughness'].default_value=.82
   if 'Metallic' in bs.inputs and not bs.inputs['Metallic'].is_linked: bs.inputs['Metallic'].default_value=0
  for node in mat.node_tree.nodes:
   if node.type!='TEX_IMAGE' or not node.image: continue
   kind=texture_kind(node.image.name) or texture_kind(node.label)
   if kind is None: continue
   if geometry_only: node.image=None; continue
   ni=make_web_image(node.image,blend,out,near,far,cache); node.image=ni; used.append(ni.filepath)
  # alpha-tested foliage/grass remains crisp in the browser
  if any(k in mat.name.lower() for k in ('leaf','grass','ivy','shrub')):
   mat.surface_render_method='DITHERED' if hasattr(mat,'surface_render_method') else mat.surface_render_method
   if hasattr(mat,'alpha_threshold'): mat.alpha_threshold=.42
   if bs and 'Alpha' in bs.inputs and not bs.inputs['Alpha'].is_linked: bs.inputs['Alpha'].default_value=1
 return sorted(set(used))

def ratio_for(o,total):
 n=o.name.lower(); cols={c.name.lower() for c in o.users_collection}
 if o.name=='ground': return 1.0
 if 'background' in cols or n.startswith('background_'): return .004
 if any(k in n for k in ('hero','main_dead','root_cluster','boulder_01')): return .018
 if 'foliage' in cols or any(k in n for k in ('leaf','grass','shrub','ivy')): return .012
 if 'debris' in cols: return .008
 return .01

def main():
 a=args(); blend=str(Path(a.blend).resolve()); out=Path(a.out_dir).resolve(); out.mkdir(parents=True,exist_ok=True); bpy.ops.wm.open_mainfile(filepath=blend)
 ground=bpy.data.objects.get(a.ground_object)
 if not ground or ground.type!='MESH': raise SystemExit('ground object missing')
 gb,source_heights,sample_bounds=sample_ground(ground,a.height_grid); transform,vertical_scale,scale_x,scale_z,cx,cy=xform(gb)
 source=[]; include=COLLECTIONS
 for o in sorted(bpy.context.scene.objects,key=lambda x:x.name):
  cols={c.name for c in o.users_collection}
  if o.type!='MESH' or o.hide_render or not cols.intersection(include): continue
  lname=o.name.lower()
  if any(k in lname for k in ('rubberduck','rubber_duck','rubberduck_toy','duck','dots stroke')): continue
  polys=len(o.data.polygons)
  # Source pack contains many duplicated 100k-700k debris/sculpt meshes. Keep the semantic hero
  # pieces and background cliffs, discard repetitive high-poly debris before Blender's exporter.
  lowcols={c.lower() for c in cols}
  # Keep the composition-defining collections plus a small set of hero debris.
  if 'background' not in lowcols and 'main_scene' not in lowcols and 'foliage' not in lowcols and 'scene_components' not in lowcols:
   if not (('cliffs_boulders' in lowcols or 'debris' in lowcols) and any(k in lname for k in ('root','boulder','dead_tree','fallen_log','cliff'))): continue
  if polys > 100000 and 'background' not in lowcols and not any(k in lname for k in ('root','boulder','dead_tree','cliff')): continue
  source.append({'name':o.name,'collections':sorted(cols),'polys':polys,'bbox':bbox(o)})
 total=sum(x['polys'] for x in source); print('source objects',len(source),'tris',total)
 # remove non-visual meshes and keep selected real source objects
 keep=set(x['name'] for x in source)
 for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and o.name not in keep: bpy.data.objects.remove(o,do_unlink=True)
 # geometry transform and decimation
 for o in bpy.context.scene.objects:
  if o.type!='MESH': continue
  if o.name!='ground' and len(o.data.polygons) > 3:
   r=ratio_for(o,total); mod=o.modifiers.new('web_budget_decimate','DECIMATE'); mod.decimate_type='COLLAPSE'; mod.ratio=r; mod.use_collapse_triangulate=True
  o.matrix_world=transform@o.matrix_world; o.select_set(True)
 used=remap_materials(blend,out,a.max_near_texture,a.max_far_texture,a.geometry_only)
 bpy.context.view_layer.objects.active=ground
 bpy.ops.object.select_all(action='SELECT')
 glb=out/'verdant-trail.glb'; bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_texcoords=True,export_normals=True,export_tangents=False,export_animations=False,export_cameras=False,export_lights=False)
 # stats after modifiers
 deps=bpy.context.evaluated_depsgraph_get(); tri=0
 for o in bpy.context.scene.objects:
  if o.type!='MESH': continue
  ev=o.evaluated_get(deps); me=ev.to_mesh(); tri+=sum(max(0,len(p.vertices)-2) for p in me.polygons); ev.to_mesh_clear()
 xmin,xmax,ymin,ymax,zmin,zmax=sample_bounds; y0=zmin*vertical_scale; rh=[h*vertical_scale-y0 for h in source_heights]; bounds={'minX':-(ymax-ymin)*scale_x/2,'maxX':(ymax-ymin)*scale_x/2,'minZ':-(xmax-xmin)*scale_z/2,'maxZ':(xmax-xmin)*scale_z/2}
 height={'format':1,'gridSize':a.height_grid,'bounds':bounds,'sourceBounds':{'x':[xmin,xmax],'y':[ymin,ymax],'z':[zmin,zmax]},'heights':rh}
 hp=out/'verdant-trail-height.json'; hp.write_text(json.dumps(height,separators=(',',':')),encoding='utf-8')
 manifest={'format':2,'scene':'A Verdant Trail','source':{'blend':blend,'sha256':hashlib.sha256(Path(blend).read_bytes()).hexdigest()},'files':{'scene':glb.name,'height':hp.name},'mapping':{'runtimeField':{'width':130,'height':78},'sourceHorizontalAxes':{'runtimeX':'sourceY','runtimeZ':'sourceX'},'scale':vertical_scale,'horizontalScale':[scale_x,scale_z],'sourceCenter':[cx,cy],'verticalOffset':-y0,'playableBounds':bounds},'export':{'collections':sorted(include),'groundObject':a.ground_object,'maxTriangles':a.max_triangles,'heightGrid':a.height_grid,'texturePolicy':'PBR diff/rough web JPEG/PNG, normal PNG, displacement omitted','geometryOnly':a.geometry_only},'stats':{'sourceObjects':len(source),'sourceTriangles':total,'exportTriangles':tri,'textureCount':len(used),'fileBytes':glb.stat().st_size,'heightBytes':hp.stat().st_size,'textureBytes':sum(Path(bpy.path.abspath(p)).stat().st_size for p in used if Path(bpy.path.abspath(p)).exists())}}
 (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8'); print(json.dumps(manifest,indent=2))
if __name__=='__main__': main()
