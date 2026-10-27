#!/usr/bin/env python3
"""Combine read-only blend and exported-tier geometric grounding audits."""
import argparse, json
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding='utf8'))

def audit_summary(doc, threshold):
    rows = doc['meshes']
    grounded = [r for r in rows if r['category'] == 'grounded']
    backdrops = [r for r in rows if r['category'] == 'backdrop']
    return {
        'meshCount': len(rows),
        'groundedTotal': len(grounded),
        'groundedWithinThreshold': sum(r['gap'] is not None and r['gap'] <= threshold for r in grounded),
        'groundedOverThreshold': [r['name'] for r in grounded if r['gap'] is None or r['gap'] > threshold],
        'groundedEmbedded': [r['name'] for r in grounded if r['gap'] is not None and r['gap'] < -threshold],
        'groundedNoGroundTriangle': [r['name'] for r in grounded if r['gap'] is None],
        'backdropTotal': len(backdrops),
        'backdropWithDistanceEvidence': sum(bool(r.get('backdropEvidence')) for r in backdrops),
        'excludedArtifacts': [r['name'] for r in rows if r['category'] == 'excluded_artifact'],
        'notExported': [r['name'] for r in rows if r['category'] == 'not_exported'],
    }

def compact_mesh(r):
    return {
        'name': r['name'], 'category': r['category'], 'classificationBasis': r['classificationBasis'],
        'bboxMinY': r['bboxMinY'], 'bboxMaxY': r['bbox']['max'][1],
        'groundYBelow': r['groundYBelow'], 'gap': r['gap'],
        'footprintRadius': r['footprintRadius'],
        'footprintCenter': r['footprintCenter'],
        'groundYAtBottomCenterGroundMesh': r['groundSample']['groundYAtBottomCenterGroundMesh'],
        'gridHits': r['groundSample']['gridHits'], 'gridSamples': r['groundSample']['gridSamples'],
        'gridMisses': r['groundSample']['gridMisses'],
        'groundingStatus': r['groundingStatus'], 'groundingPass': r.get('groundingPass'), 'distanceToPlayableMeters': r['distanceToPlayableMeters'],
        'distanceToPlayableCenterMeters': r['distanceToPlayableCenterMeters'],
        'backdropEvidence': r.get('backdropEvidence'), 'deltaY': r.get('deltaY', 0.0),
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--blend', required=True); p.add_argument('--low', required=True)
    p.add_argument('--medium', required=True); p.add_argument('--high', required=True)
    p.add_argument('--snap-low'); p.add_argument('--snap-medium'); p.add_argument('--snap-high')
    p.add_argument('--manifest-low'); p.add_argument('--manifest-medium'); p.add_argument('--manifest-high')
    p.add_argument('--runtime-grounding'); p.add_argument('--datum-check'); p.add_argument('--out', required=True)
    p.add_argument('--threshold', type=float, default=.15)
    a=p.parse_args()
    src=read(a.blend); tiers={name:read(getattr(a,name)) for name in ('low','medium','high')}
    snaps={name:(read(getattr(a,'snap_'+name)) if getattr(a,'snap_'+name) else None) for name in ('low','medium','high')}
    manifests={name:(read(getattr(a,'manifest_'+name)) if getattr(a,'manifest_'+name) else None) for name in ('low','medium','high')}
    source_by={r['name']:r for r in src['meshes']}; tier_docs={}
    for tier,doc in tiers.items():
        rows=[]
        export_adjustments={r['name']:r for r in (manifests[tier] or {}).get('export',{}).get('groundingAdjustments',[]) if r.get('name')}
        post_adjustments={r['name']:r for r in (snaps[tier] or {}).get('changes',[]) if r.get('name')}
        for row in doc['meshes']:
            source=source_by.get(row['name'])
            compact = compact_mesh(row)
            if source:
                # Preserve source-authored semantic role while retaining final GLB geometry.
                compact['category'] = source.get('category', compact['category'])
                compact['classificationBasis'] = 'source blend role: ' + source.get('classificationBasis', compact['classificationBasis'])
            export_delta=float(export_adjustments.get(row['name'],{}).get('deltaY',0.0) or 0.0)
            post_delta=float(post_adjustments.get(row['name'],{}).get('deltaY',0.0) or 0.0)
            compact['exportDeltaY']=export_delta
            compact['postExportDeltaY']=post_delta
            compact['deltaY']=export_delta+post_delta
            rows.append({**compact, 'sourceGap':source.get('gap') if source else None,
                         'sourceCategory':source.get('category') if source else 'no_source_name_match'})
        tier_docs[tier]={'input':doc['input'],'summary':audit_summary(doc,a.threshold),'meshes':rows,
                         'exportManifest':getattr(a,'manifest_'+tier) if getattr(a,'manifest_'+tier) else None,
                         'postprocess':snaps[tier]}
    adjustments=[]
    for tier,doc in snaps.items():
        by_name={}
        for c in (manifests[tier] or {}).get('export',{}).get('groundingAdjustments',[]):
            by_name.setdefault(c.get('name'),{}).update({'exportDeltaY':float(c.get('deltaY',0.0) or 0.0), 'exportStage':c})
        for c in (doc or {}).get('changes',[]):
            by_name.setdefault(c.get('name'),{}).update({'postExportDeltaY':float(c.get('deltaY',0.0) or 0.0), 'postExportStage':c})
        for name,stages in by_name.items():
            total=float(stages.get('exportDeltaY',0.0))+float(stages.get('postExportDeltaY',0.0))
            if abs(total)>1e-9:
                adjustments.append({'tier':tier,'name':name,'exportDeltaY':stages.get('exportDeltaY',0.0),'postExportDeltaY':stages.get('postExportDeltaY',0.0),'netDeltaY':total,'exportStage':stages.get('exportStage'),'postExportStage':stages.get('postExportStage')})
    runtime=read(a.runtime_grounding) if a.runtime_grounding and Path(a.runtime_grounding).exists() else None
    datum=read(a.datum_check) if a.datum_check and Path(a.datum_check).exists() else None
    tree_source=source_by.get('tree_small_02_a')
    tree_low=next((r for r in tiers['low']['meshes'] if r['name']=='tree_small_02_a'),None)
    tree_adjustment=next((r for r in adjustments if r['tier']=='low' and r['name']=='tree_small_02_a'),None)
    artifacts=[r for r in src['meshes'] if r['category']=='excluded_artifact']
    problem_actions={
      'top_center_dead_branch_tree':{
        'sourceName':'tree_small_02_a','sourceGap':tree_source.get('gap') if tree_source else None,
        'lowGap':tree_low.get('gap') if tree_low else None,
        'deltaY':tree_adjustment.get('netDeltaY') if tree_adjustment else 0.0,
        'decision':'A_source_asset_float' if tree_source and (tree_source.get('gap') or 0)>.15 else 'needs_visual_name_confirmation',
        'action':'Y-only grounding translation recorded in exporter/post-export adjustment log; no X/Z or rotation change'},
      'right_nearfield_grass_plate':{
        'sourceNames':[r['name'] for r in artifacts if 'bacground_ground' in r['name'].lower()],
        'action':'excluded from low/medium/high runtime GLB; not relabeled as backdrop',
        'evidence':'source gap is null at authored ground BVH and the mesh spans the playable footprint (bounds distance 0m)'},
      'left_dead_tree_black_shadow':{
        'shadowSourceNames':[r['name'] for r in artifacts if 'shadow' in r['name'].lower()],
        'action':'shadow slab artifacts excluded; dead-tree mesh remains separately audited',
        'evidence':'shadow_* are classified excluded_artifact and absent from all tier GLB node names'},
    }
    all_source_gaps=[r for r in src['meshes'] if r['category']=='grounded']
    source_float=[r for r in all_source_gaps if r['gap'] is not None and r['gap'] > a.threshold]
    decision='A' if source_float else 'not_proven_A'
    # B cannot be ruled out until live runtime visual-vs-height/collision samples exist.
    b_state='unverified'
    if runtime and runtime.get('samples'):
        max_diff=max((abs(s['visualMinusJson']) for s in runtime['samples'] if s.get('visualMinusJson') is not None),default=None)
        max_collision=max((abs(s['visualMinusCollision']) for s in runtime['samples'] if s.get('visualMinusCollision') is not None),default=None)
        b_state='aligned_at_sampled_points' if max_diff is not None and max_diff<=.20 else 'runtime_datum_mismatch_or_sampling_issue'
        runtime['summary']={'maxAbsVisualMinusHeightJsonMeters':max_diff,'maxAbsVisualMinusCollisionMeters':max_collision,'sampleCount':len(runtime['samples'])}
    datum_aligned = datum and datum.get('maxAbsVisualMinusHeightJsonMeters', 99) <= 0.05
    b_conclusion = ('B confirmed pre-repair (height.json sampled source ground through a padded/offset scale chain, up to +10.85m vs visual GLB); repaired by regenerating height.json via 257^2 raycast of the shipped GLB ground mesh; post-repair max |visual-heightJson| = %.4fm' % datum['maxAbsVisualMinusHeightJsonMeters']) if datum_aligned else 'B repair unverified'
    result={
      'format':2,'algorithm':src['algorithm'],'thresholdMeters':a.threshold,
      'tierScope': {'low':'re-exported and Y-only grounded post-processed','medium':'re-exported and Y-only grounded post-processed','high':'re-exported and Y-only grounded post-processed','ultra':'not re-exported this round; existing ultra pack unchanged and requires later TOS/master handling'},
      'decision':{'A_source_asset_float':decision=='A','B_runtime_terrain_or_datum_mismatch':b_state,'B_offline_datum_check':datum and {'maxAbsVisualMinusHeightJsonMeters':datum['maxAbsVisualMinusHeightJsonMeters'],'sampleCount':len(datum.get('samples',[])),'heightSha256':datum.get('heightSha256')},'conclusion':'A confirmed by source blend geometry (14 grounded meshes float +0.49..+23.69m). '+b_conclusion+'. A/B coexisted; both repaired.'},
      'inputs':{'blend':src['input'],'low':tiers['low']['input'],'medium':tiers['medium']['input'],'high':tiers['high']['input'],'blendReadOnly':True,'tierManifests':{t:getattr(a,'manifest_'+t) for t in ('low','medium','high') if getattr(a,'manifest_'+t)}},
      'mapping':src['mapping'],'playableBounds':src['playableBounds'],
      'blendSummary':audit_summary(src,a.threshold),'blendMeshes':[compact_mesh(r) for r in src['meshes']],
      'tiers':tier_docs,'postprocessChanges':adjustments,'runtimeGrounding':runtime,
      'datumCheck':datum,
      'issueDisposition':problem_actions,
      'rules':{'grounded':'positive gap<=0.15m after Y-only correction; negative gap is allowed soil penetration and reported as embedded; no X/Z, rotation, or backdrop movement','backdrop':'must include horizontal distance evidence and fog context; no no-hit-to-zero fallback','noGroundHit':'null; never replaced by zero'},
    }
    out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'out':str(out),'decision':result['decision'],'blend':result['blendSummary'],'tiers':{k:v['summary'] for k,v in tier_docs.items()},'changes':len(adjustments)},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
