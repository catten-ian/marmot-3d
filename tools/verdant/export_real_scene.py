#!/usr/bin/env python3
"""Export the supplied A Verdant Trail Blender scene as a web-sized, textured GLB.

Run with Blender's Python: blender -b --python this_file.py -- --blend ... --out-dir ...
The source blend is never modified. All selected objects keep their original geometry/materials,
then receive a bounded decimate pass and the exact legacy Verdant coordinate transform.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, sys, subprocess
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

COLLECTIONS={'main_scene','foliage','debris','cliffs_boulders','background','scene_components','debris_patches','grass_medium_02','hanging_grass','island_tree_01_branches','island_tree_01_leaves','jacaranda_tree_leaves','shrub_01','shrub_03','shrub_04','tree_small_02_leaves'}
IMAGE_KINDS=('diff','basecolor','albedo','nor_gl','normal','rough','roughness','alpha','opacity','mask','disp','displacement')
CURRENT_PROFILE={}; CURRENT_TIER='medium'; CURRENT_NATIVE_MAP={}

def args():
 p=argparse.ArgumentParser(); p.add_argument('--blend',required=True); p.add_argument('--out-dir',required=True); p.add_argument('--tier',choices=['low','medium','high','ultra','all'],default='medium'); p.add_argument('--max-triangles',type=int,default=None); p.add_argument('--ground-object',default='ground'); p.add_argument('--height-grid',type=int,default=None); p.add_argument('--max-near-texture',type=int,default=None); p.add_argument('--max-far-texture',type=int,default=None); p.add_argument('--geometry-only',action='store_true'); p.add_argument('--native-textures',default=None, help='ultra native texture directory containing texture-cache.json')
 av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]; return p.parse_args(av)

TIER_PROFILES={
 'low': {'max_triangles':400000,'height_grid':257,'near':768,'far':384,'normal':384,'decimate':True},
 'medium': {'max_triangles':850000,'height_grid':257,'near':1024,'far':512,'normal':512,'decimate':True},
 'high': {'max_triangles':2000000,'height_grid':257,'near':2048,'far':1536,'normal':1024,'decimate':True},
 'ultra': {'max_triangles':None,'height_grid':257,'near':2048,'far':512,'normal':1024,'decimate':False},
}

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

def runtime_point(p, matrix):
 q=matrix@p
 return Vector((q.x,q.z,-q.y))

def object_runtime_points(obj, depsgraph, matrix):
 ev=obj.evaluated_get(depsgraph); me=ev.to_mesh()
 try: pts=[runtime_point(ev.matrix_world@v.co,matrix) for v in me.vertices]
 finally: ev.to_mesh_clear()
 return pts or [runtime_point(obj.matrix_world@Vector(c),matrix) for c in obj.bound_box]

def object_target_runtime_points(obj, depsgraph):
 ev=obj.evaluated_get(depsgraph); me=ev.to_mesh()
 try: pts=[Vector((p.x,p.z,-p.y)) for p in (ev.matrix_world@v.co for v in me.vertices)]
 finally: ev.to_mesh_clear()
 return pts or [Vector((p.x,p.z,-p.y)) for p in (obj.matrix_world@Vector(c) for c in obj.bound_box)]

def support_gap(points, ground_bvh, transform, vertical_scale, vertical_offset):
 """AABB-min-Y minus the real ground triangle below the AABB footprint center."""
 xs=[p.x for p in points]; ys=[p.y for p in points]; zs=[p.z for p in points]
 mn=[min(xs),min(ys),min(zs)]; mx=[max(xs),max(ys),max(zs)]
 cx=(mn[0]+mx[0])/2; cz=(mn[2]+mx[2])/2
 inv=transform.inverted(); source=inv@Vector((cx,-cz,0))
 hit=ground_bvh.ray_cast(Vector((source.x,source.y,10000)),Vector((0,0,-1)),20000)
 gy=None if hit[0] is None else float(hit[0].z*vertical_scale+vertical_offset)
 return (None if gy is None else float(mn[1]-gy)), gy, mn, mx

def distance_to_playable(mn,mx,playable):
 dx=max(playable['minX']-mx[0],0,mn[0]-playable['maxX'])
 dz=max(playable['minZ']-mx[2],0,mn[2]-playable['maxZ'])
 return math.hypot(dx,dz)

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
 kind=texture_kind(img.name) or texture_kind(src.name) or 'diff'
 # Ultra is source-faithful: load the prepared native copy without any scale or quality change.
 if CURRENT_TIER == 'ultra' and CURRENT_NATIVE_MAP:
  native = CURRENT_NATIVE_MAP.get(src.name) or CURRENT_NATIVE_MAP.get(src.stem)
  if native and Path(native).exists():
   key=('native',str(native))
   if key not in cache: cache[key]=bpy.data.images.load(str(native),check_existing=True)
   return cache[key]
 is_near=any(k in src.name.lower() for k in ('ground','dirt','rock','boulder','root','trunk'))
 limit=near if is_near else far
 if kind=='normal': limit=min(limit, CURRENT_PROFILE['normal'])
 if kind=='normal': ext='.png'
 elif kind in ('rough','alpha','displacement'): ext='.png' if kind in ('alpha','displacement') else '.jpg'
 else: ext='.jpg'
 key=(str(src),kind,limit)
 if key in cache: return cache[key]
 safe=src.stem.replace(' ','_')+f'_{limit}'+ext; dest=out/safe
 try:
  if not dest.exists():
   im=bpy.data.images.load(str(src),check_existing=True); cp=im.copy(); cp.name='web_'+safe; cp.scale(limit,limit)
   if ext=='.jpg': cp.file_format='JPEG'; cp.save(filepath=str(dest),quality=88)
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
 if CURRENT_PROFILE['decimate'] is False: return 1.0
 if 'background' in cols or n.startswith('background_'): return min(1.0, .004 * {'low':1.0,'medium':1.8,'high':5.0,'ultra':1.0}[CURRENT_TIER])
 if any(k in n for k in ('hero','main_dead','root_cluster','boulder_01')): return min(1.0, .018 * {'low':1.0,'medium':2.5,'high':7.0,'ultra':1.0}[CURRENT_TIER])
 if 'foliage' in cols or any(k in n for k in ('leaf','grass','shrub','ivy')): return min(1.0, .012 * {'low':1.0,'medium':2.5,'high':7.0,'ultra':1.0}[CURRENT_TIER])
 if 'debris' in cols: return min(1.0, .008 * {'low':1.0,'medium':2.5,'high':7.0,'ultra':1.0}[CURRENT_TIER])
 return min(1.0, .01 * {'low':1.0,'medium':2.5,'high':7.0,'ultra':1.0}[CURRENT_TIER])

def main():
 global CURRENT_PROFILE, CURRENT_TIER, CURRENT_NATIVE_MAP
 a=args()
 if a.tier=='all':
  base=Path(a.out_dir).resolve()
  for tier in ('low','medium','high','ultra'):
   cmd=[bpy.app.binary_path,'-b','--python',str(Path(__file__).resolve()),'--','--blend',str(Path(a.blend).resolve()),'--out-dir',str(base/'tiers'/tier),'--tier',tier]
   print('export tier:',tier,flush=True); subprocess.run(cmd,check=True)
  raise SystemExit(0)
 CURRENT_TIER=a.tier; CURRENT_PROFILE={**TIER_PROFILES[a.tier]}
 if a.native_textures:
  cache_file=Path(a.native_textures).resolve()/'texture-cache.json'
  if cache_file.exists():
   for rec in json.loads(cache_file.read_text(encoding='utf-8')):
    if rec.get('sourceName') and rec.get('output'):
     native_path=Path(rec['output'])
     CURRENT_NATIVE_MAP[rec['sourceName']]=str(native_path if native_path.is_absolute() else cache_file.parent/native_path)
  print('native texture map:',len(CURRENT_NATIVE_MAP),flush=True)
 if a.max_triangles is not None: CURRENT_PROFILE['max_triangles']=a.max_triangles
 if a.height_grid is not None: CURRENT_PROFILE['height_grid']=a.height_grid
 if a.max_near_texture is not None: CURRENT_PROFILE['near']=a.max_near_texture
 if a.max_far_texture is not None: CURRENT_PROFILE['far']=a.max_far_texture
 blend=str(Path(a.blend).resolve()); out=Path(a.out_dir).resolve(); out.mkdir(parents=True,exist_ok=True); bpy.ops.wm.open_mainfile(filepath=blend)
 ground=bpy.data.objects.get(a.ground_object)
 if not ground or ground.type!='MESH': raise SystemExit('ground object missing')
 gb,source_heights,sample_bounds=sample_ground(ground,CURRENT_PROFILE['height_grid']); transform,vertical_scale,scale_x,scale_z,cx,cy=xform(gb)
 source=[]; include=COLLECTIONS; excluded_background=[]
 for o in sorted(bpy.context.scene.objects,key=lambda x:x.name):
  cols={c.name for c in o.users_collection}
  if o.type!='MESH' or o.hide_render or not cols.intersection(include): continue
  lname=o.name.lower()
  # The source's typo-named broad grass plate spans the playable footprint and
  # has no ground-triangle support; it is the visible near-field hovering slab.
  # Remove it rather than relabeling it as remote scenery. Fog/shadow artifacts
  # are likewise not runtime scene geometry.
  if lname == 'bacground_ground' or lname.startswith('shadow_'):
   excluded_background.append({'name':o.name,'reason':'near-field unsupported background/shadow slab; excluded from playable GLB'})
   continue
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
 # geometry transform and decimation. Bake world matrices and clear parents so
 # Blender children (notably jacaranda branches) are not transformed twice by glTF.
 # Snapshot all source world matrices before changing parents or baking meshes.
 source_world={o.name:o.matrix_world.copy() for o in bpy.context.scene.objects if o.type=='MESH'}
 # Grounding uses the AABB bottom-center projected onto an actual ground BVH;
 # this is also the audit script's primary gap definition.
 grounding_adjustments=[]
 ground_bvh=bvh_for(ground)
 playable_runtime={'minX':-(sample_bounds[3]-sample_bounds[2])*scale_x/2,'maxX':(sample_bounds[3]-sample_bounds[2])*scale_x/2,'minZ':-(sample_bounds[1]-sample_bounds[0])*scale_z/2,'maxZ':(sample_bounds[1]-sample_bounds[0])*scale_z/2}
 depsgraph=bpy.context.evaluated_depsgraph_get()
 inv_transform=transform.inverted()
 for o in bpy.context.scene.objects:
  if o.type!='MESH': continue
  if o.name!='ground' and len(o.data.polygons) > 3 and CURRENT_PROFILE['decimate']:
   r=ratio_for(o,total); mod=o.modifiers.new('web_budget_decimate','DECIMATE'); mod.decimate_type='COLLAPSE'; mod.ratio=r; mod.use_collapse_triangulate=True
   # Contact is audited after the exact tier's decimation so the exported
   # lowest vertex cannot reintroduce a visible float.
   bpy.context.view_layer.update()
  depsgraph=bpy.context.evaluated_depsgraph_get()
  source_mw=source_world[o.name]
  if o.name!='ground':
   n=o.name.lower(); cols={c.name.lower() for c in o.users_collection}
   source_points=object_runtime_points(o,depsgraph,transform)
   source_gap, source_ground_y, source_mn, source_mx=support_gap(source_points,ground_bvh,transform,vertical_scale,-(sample_bounds[4]*vertical_scale))
   source_center=[(source_mn[i]+source_mx[i])/2 for i in range(3)]
   dist=distance_to_playable(source_mn,source_mx,playable_runtime)
   semantic_backdrop=(n.startswith('background_cliff') or n=='background_water' or (('background' in cols) and any(k in n for k in ('island_tree','tree_small_02','jacaranda'))))
   center_dist=math.hypot(source_center[0],source_center[2])
   backdrop=semantic_backdrop and dist>=8.0
   noncontact=any(k in n for k in ('leaves','branch','ivy','foliage','grass','sand','ground','cliff')) and not any(k in n for k in ('root','trunk','dead_tree'))
   contact_name=any(k in n for k in ('tree','trunk','root','boulder','rock','stone','shrub','fallen_log'))
   grounded=(not backdrop and not noncontact and contact_name)
   baked_world=transform@source_mw
   o.parent=None; o.matrix_world=baked_world
   bpy.context.view_layer.update()
   # Recompute the actual pre-correction mesh after Blender decomposes the
   # baked world matrix to glTF-compatible TRS; never trust nominal delta only.
   baked_points=object_target_runtime_points(o,bpy.context.evaluated_depsgraph_get())
   baked_gap,baked_ground_y,baked_mn,baked_mx=support_gap(baked_points,ground_bvh,transform,vertical_scale,-(sample_bounds[4]*vertical_scale))
   delta_y=0.0; reason='backdrop immutable' if backdrop else 'decorative/terrain component; contact proxy audited separately' if noncontact else 'within tolerance or no ground triangle support'
   # Correct only positive clearance after the exact tier's decimation. The
   # baked scene is Z-up here, so runtime-Y translates along local/world Z.
   # Keep authored X/Z and rotation untouched; do not move backdrops or props
   # already within tolerance / intentionally embedded in soil.
   if grounded and baked_gap is not None and baked_gap>0.15:
    delta_y=0.03-baked_gap
    o.location.z += delta_y
    bpy.context.view_layer.update()
    reason='post-bake positive float snapped down to 0.03m soil embed (Y-only)'
   final_points=object_target_runtime_points(o,bpy.context.evaluated_depsgraph_get())
   final_gap,final_ground_y,final_mn,final_mx=support_gap(final_points,ground_bvh,transform,vertical_scale,-(sample_bounds[4]*vertical_scale))
   grounding_adjustments.append({'name':o.name,'classification':'backdrop' if backdrop else 'grounded' if grounded else 'decorative_noncontact','sourceGapBefore':source_gap,'sourceBBoxMinY':source_mn[1],'sourceGroundYBelow':source_ground_y,'bakedGapBefore':baked_gap,'bakedBBoxMinY':baked_mn[1],'bakedGroundYBelow':baked_ground_y,'bboxMinYAfter':final_mn[1],'groundYBelowAfter':final_ground_y,'gapAfter':final_gap,'deltaY':delta_y,'reason':reason,'distanceToPlayableMeters':dist,'backdropEvidence':{'semanticName':semantic_backdrop,'distanceToPlayableMeters':dist,'remoteDistanceThresholdMeters':8.0,'distanceToPlayableCenterMeters':center_dist,'centerDistanceAloneIsSufficient':False} if backdrop else None})
  else:
   o.parent=None; o.matrix_world=transform@source_mw
  o.select_set(True)
 used=remap_materials(blend,out,CURRENT_PROFILE['near'],CURRENT_PROFILE['far'],a.geometry_only)
 bpy.context.view_layer.objects.active=ground
 bpy.ops.object.select_all(action='SELECT')
 scene_path=out/f'verdant-trail-{a.tier}.gltf' if a.tier=='ultra' else out/f'verdant-trail-{a.tier}.glb'
 export_kwargs=dict(filepath=str(scene_path),export_format='GLTF_SEPARATE' if a.tier=='ultra' else 'GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_texcoords=True,export_normals=True,export_tangents=False,export_animations=False,export_cameras=False,export_lights=False)
 if a.tier=='ultra':
  export_kwargs.update(export_image_format='AUTO',export_texture_dir='textures',export_keep_originals=True,export_unused_images=False,export_unused_textures=False)
 bpy.ops.export_scene.gltf(**export_kwargs)
 glb=scene_path
 # stats after modifiers
 deps=bpy.context.evaluated_depsgraph_get(); tri=0
 for o in bpy.context.scene.objects:
  if o.type!='MESH': continue
  ev=o.evaluated_get(deps); me=ev.to_mesh(); tri+=sum(max(0,len(p.vertices)-2) for p in me.polygons); ev.to_mesh_clear()
 xmin,xmax,ymin,ymax,zmin,zmax=sample_bounds; y0=zmin*vertical_scale; rh=[h*vertical_scale-y0 for h in source_heights]; bounds={'minX':-(ymax-ymin)*scale_x/2,'maxX':(ymax-ymin)*scale_x/2,'minZ':-(xmax-xmin)*scale_z/2,'maxZ':(xmax-xmin)*scale_z/2}
 height={'format':1,'gridSize':CURRENT_PROFILE['height_grid'],'bounds':bounds,'sourceBounds':{'x':[xmin,xmax],'y':[ymin,ymax],'z':[zmin,zmax]},'heights':rh}
 hp=out/f'verdant-trail-{a.tier}-height.json'; hp.write_text(json.dumps(height,separators=(',',':')),encoding='utf-8')
 manifest={'format':2,'scene':'A Verdant Trail','source':{'blend':'verdant_trail.blend (external source asset)','sha256':hashlib.sha256(Path(blend).read_bytes()).hexdigest()},'files':{'scene':glb.name,'height':hp.name},'mapping':{'runtimeField':{'width':130,'height':78},'sourceHorizontalAxes':{'runtimeX':'sourceY','runtimeZ':'sourceX'},'scale':vertical_scale,'horizontalScale':[scale_x,scale_z],'sourceCenter':[cx,cy],'verticalOffset':-y0,'playableBounds':bounds},'export':{'collections':sorted(include),'groundObject':a.ground_object,'tier':a.tier,'maxTriangles':CURRENT_PROFILE['max_triangles'],'heightGrid':CURRENT_PROFILE['height_grid'],'texturePolicy':('native source resolution; external glTF + .bin + textures; displacement retained in native pack' if a.tier=='ultra' else 'PBR diff/rough web JPEG/PNG, normal PNG, displacement omitted'),'geometryOnly':a.geometry_only,'textureTiers':{'near':CURRENT_PROFILE['near'],'far':CURRENT_PROFILE['far'],'normal':CURRENT_PROFILE['normal']},'decimation':CURRENT_PROFILE['decimate'],'groundingAdjustments':grounding_adjustments,'excludedBackgroundObjects':excluded_background,'applicableDevice':{'low':'移动端/低功耗设备','medium':'普通桌面','high':'高性能桌面','ultra':'高性能独显 + WebGPU'}[a.tier]},'stats':{'externalResources': a.tier=='ultra', 'sourceObjects':len(source),'sourceTriangles':total,'exportTriangles':tri,'textureCount':len(used),'fileBytes':glb.stat().st_size,'heightBytes':hp.stat().st_size,'textureBytes':sum(Path(bpy.path.abspath(p)).stat().st_size for p in used if Path(bpy.path.abspath(p)).exists())}}
 (out/f'manifest-{a.tier}.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8'); print(json.dumps(manifest,indent=2))
if __name__=='__main__': main()
