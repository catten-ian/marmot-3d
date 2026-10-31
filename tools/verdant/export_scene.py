#!/usr/bin/env python3
"""Deterministic browser export for the supplied Poly Haven A Verdant Trail blend.

The staged blend is intentionally never copied into the repository. The default export builds a
low-poly proxy from the source scene's evaluated ground and object bounds. This avoids loading the
multi-gigabyte source image set into a browser and keeps Blender's memory bounded while retaining
scene composition, silhouettes, and a real sampled walkable ground.
"""
from __future__ import annotations
import argparse, hashlib, json, sys
from pathlib import Path
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

DEFAULT_COLLECTIONS = ['main_scene','foliage','debris','cliffs_boulders','background','scene_components',
                       'debris_patches','grass_medium_02','hanging_grass','island_tree_01_branches',
                       'island_tree_01_leaves','jacaranda_tree_leaves','shrub_01','shrub_03','shrub_04',
                       'tree_small_02_leaves']

def args():
    p=argparse.ArgumentParser()
    p.add_argument('--blend', required=True); p.add_argument('--out-dir', required=True)
    p.add_argument('--max-triangles', type=int, default=120000)
    p.add_argument('--ground-object', default='ground'); p.add_argument('--height-grid', type=int, default=97)
    p.add_argument('--include-collections', default=','.join(DEFAULT_COLLECTIONS))
    p.add_argument('--texture-size', type=int, default=1024)
    av=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:]
    return p.parse_args(av)

def bbox(obj):
    ps=[obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (min(v.x for v in ps),max(v.x for v in ps),min(v.y for v in ps),max(v.y for v in ps),min(v.z for v in ps),max(v.z for v in ps))

def bvh_for(obj):
    deps=bpy.context.evaluated_depsgraph_get(); ev=obj.evaluated_get(deps); me=ev.to_mesh()
    try:
        vs=[ev.matrix_world @ v.co for v in me.vertices]; fs=[[i for i in f.vertices] for f in me.polygons]
        return BVHTree.FromPolygons(vs,fs,all_triangles=False)
    finally: ev.to_mesh_clear()

def sample_ground(obj,n):
    b=bbox(obj); xmin,xmax,ymin,ymax,zmin,zmax=b; px=(xmax-xmin)*.006; py=(ymax-ymin)*.006
    xmin+=px;xmax-=px;ymin+=py;ymax-=py; tree=bvh_for(obj); hs=[]
    for j in range(n):
        sy=ymin+(ymax-ymin)*j/(n-1)
        for i in range(n):
            sx=xmin+(xmax-xmin)*i/(n-1); hit=tree.ray_cast(Vector((sx,sy,zmax+100)),Vector((0,0,-1)),200)
            hs.append(float(hit[0].z) if hit[0] is not None else float(zmin))
    return b,hs,(xmin,xmax,ymin,ymax,zmin,zmax)

def xform(bounds):
    xmin,xmax,ymin,ymax,zmin,zmax=bounds; sw=xmax-xmin; sh=ymax-ymin
    sx=130/sh*.88; sz=78/sw*.88; sy=min(sx,sz); cx=(xmin+xmax)/2; cy=(ymin+ymax)/2
    # Blender (x,y,z) -> transformed (X,Y,Z); exporter converts to glTF Y-up.
    m=Matrix(((0,sx,0,-sx*cy),(-sz,0,0,sz*cx),(0,0,sy,-sy*zmin),(0,0,0,1)))
    return m,sy,sx,sz,cx,cy

def col_for(name,coll):
    n=(name+' '+' '.join(coll)).lower()
    if 'ground' in n or 'sand' in n or 'dirt' in n: return (0.34,0.42,0.24,1)
    if any(k in n for k in ('tree','shrub','grass','foliage','leaf','ivy')): return (0.20,0.38,0.16,1)
    if any(k in n for k in ('rock','cliff','stone','boulder')): return (0.34,0.31,0.25,1)
    if any(k in n for k in ('branch','root','trunk','debris')): return (0.25,0.20,0.13,1)
    return (0.28,0.36,0.22,1)

def mat(name,c):
    m=bpy.data.materials.new(name); m.diffuse_color=c; m.use_nodes=True
    bs=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    bs.inputs['Base Color'].default_value=c; bs.inputs['Roughness'].default_value=.92
    return m

def add_proxy(obj, b, transform, material, name):
    xmin,xmax,ymin,ymax,zmin,zmax=b; cx=(xmin+xmax)/2; cy=(ymin+ymax)/2; cz=(zmin+zmax)/2
    sx=max((xmax-xmin)/2,.035); sy=max((ymax-ymin)/2,.035); sz=max((zmax-zmin)/2,.035)
    n=name.lower(); typ='cube'
    if any(k in n for k in ('tree','trunk','branch','shrub','grass','foliage','leaf','ivy')): typ='cone'
    elif any(k in n for k in ('rock','cliff','stone','boulder','root','debris')): typ='ico'
    if typ=='cone': bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=max(sx,sy)*.55, radius2=max(sx,sy)*.12, depth=max(sz*2, .18), location=(cx,cy,cz))
    elif typ=='ico': bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1,location=(cx,cy,cz))
    else: bpy.ops.mesh.primitive_cube_add(size=1,location=(cx,cy,cz))
    p=bpy.context.object; p.name='VerdantProxy_'+name; p.scale=(sx,sy,sz); p.matrix_world=transform @ p.matrix_world; p.data.materials.append(material); return p

def main():
    a=args(); out=Path(a.out_dir).resolve(); out.mkdir(parents=True,exist_ok=True); blend=Path(a.blend).resolve()
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    ground=bpy.data.objects.get(a.ground_object)
    if not ground or ground.type!='MESH': raise SystemExit('ground object missing: '+a.ground_object)
    ground_bounds, source_heights, sample_bounds=sample_ground(ground,a.height_grid); transform,vertical_scale,scale_x,scale_z,cx,cy=xform(ground_bounds)
    include={x.strip() for x in a.include_collections.split(',') if x.strip()}
    source=[]
    for o in sorted(bpy.context.scene.objects,key=lambda x:x.name):
        if o.type!='MESH' or o.hide_render or not ({c.name for c in o.users_collection}&include): continue
        source.append({'name':o.name,'bbox':bbox(o),'collections':sorted(c.name for c in o.users_collection),'polys':len(o.data.polygons)})
    source_tri=sum(x['polys'] for x in source)
    # Remove all source objects before constructing lightweight proxies.
    for o in list(bpy.data.objects): bpy.data.objects.remove(o,do_unlink=True)
    # Ground grid in source coordinates, transformed once for GLB export.
    xmin,xmax,ymin,ymax,zmin,zmax=sample_bounds; n=a.height_grid; verts=[]; faces=[]
    for j in range(n):
        sy=ymin+(ymax-ymin)*j/(n-1)
        for i in range(n):
            source_x=xmin+(xmax-xmin)*i/(n-1); z=source_heights[j*n+i]; verts.append(tuple(transform @ Vector((source_x,sy,z))))
    for j in range(n-1):
        for i in range(n-1):
            q=j*n+i; faces.append((q,q+1,q+n+1,q+n))
    me=bpy.data.meshes.new('VerdantWalkableGround'); me.from_pydata(verts,[],faces); me.update(); go=bpy.data.objects.new('VerdantWalkableGround',me); bpy.context.collection.objects.link(go); me.materials.append(mat('VerdantGround',(0.28,0.42,0.20,1)))
    # Build one small proxy for every source object. Dense geometry is represented by bounds,
    # preserving placement and the major trail/foliage/cliff silhouettes at a tiny cost.
    cache={}; proxies=0
    proxy_budget = max(1, a.max_triangles // 40)
    proxy_source = source if len(source) <= proxy_budget else sorted(source, key=lambda x: (-x['polys'], x['name']))[:proxy_budget]
    for s in proxy_source:
        key=tuple(col_for(s['name'],s['collections']))
        if key not in cache: cache[key]=mat('Verdant_'+str(len(cache)),key)
        add_proxy(None,s['bbox'],transform,cache[key],s['name']); proxies+=1
    for o in bpy.context.selected_objects: o.select_set(False)
    for o in bpy.context.scene.objects: o.select_set(True)
    bpy.context.view_layer.objects.active=go
    glb=out/'verdant-trail.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,export_apply=True,export_materials='EXPORT',export_texcoords=False,export_normals=True,export_animations=False,export_cameras=False,export_lights=False)
    y0=zmin*vertical_scale; rh=[h*vertical_scale-y0 for h in source_heights]
    bounds={'minX':-(ymax-ymin)*scale_x/2,'maxX':(ymax-ymin)*scale_x/2,'minZ':-(xmax-xmin)*scale_z/2,'maxZ':(xmax-xmin)*scale_z/2}
    height={'format':1,'gridSize':n,'bounds':bounds,'sourceBounds':{'x':[xmin,xmax],'y':[ymin,ymax],'z':[zmin,zmax]},'heights':rh}
    (out/'verdant-trail-height.json').write_text(json.dumps(height,separators=(',',':')),encoding='utf-8')
    manifest={'format':1,'scene':'A Verdant Trail','source':{'blend':str(blend),'sha256':hashlib.sha256(blend.read_bytes()).hexdigest()},'files':{'scene':glb.name,'height':'verdant-trail-height.json'},'mapping':{'runtimeField':{'width':130,'height':78},'sourceHorizontalAxes':{'runtimeX':'sourceY','runtimeZ':'sourceX'},'scale':vertical_scale,'horizontalScale':[scale_x,scale_z],'sourceCenter':[cx,cy],'verticalOffset':-y0,'playableBounds':bounds},'export':{'collections':sorted(include),'groundObject':a.ground_object,'maxTriangles':a.max_triangles,'heightGrid':n,'texturePolicy':'geometry proxy + material base colors; no source images','textureSizePolicy':a.texture_size},'stats':{'sourceObjects':len(source),'sourceTriangles':source_tri,'proxyObjects':proxies,'proxyBudget':proxy_budget,'proxyTriangles':sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH'),'fileBytes':glb.stat().st_size,'heightBytes':(out/'verdant-trail-height.json').stat().st_size}}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8'); print(json.dumps(manifest,indent=2))
if __name__=='__main__': main()
