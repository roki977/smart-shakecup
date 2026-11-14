"""Evidence-preserving presentation; no sensory diagnosis or automatic step detection."""
import json,hashlib
from pathlib import Path
from functools import lru_cache

@lru_cache(maxsize=1)
def knowledge():
    return json.loads((Path(__file__).resolve().parent.parent/'调酒知识库/知识库.json').read_text())

TITLES={'load':'准备原料与冰','add':'加入原料','add_ice':'加冰','shake':'摇和','stir':'搅拌','strain':'过滤入杯','double_strain':'双重过滤','fine_strain':'细滤','garnish':'完成装饰','serve':'出品','prechill':'预冷杯子','muddle':'捣压原料','top':'补足配料','float':'轻铺上层','do_not_stir':'保持分层，不搅拌'}

def context(recipe_id,version):
    kb=knowledge();recipe=next((r for r in kb['recipes'] if r['id']==recipe_id and r['recipe_version']==version),None)
    if recipe is None:return None,{},{}
    return recipe,{c['id']:c for c in kb['components']},{s['id']:s for s in kb['sources']}

def steps(recipe_id,version):
    r,components,sources=context(recipe_id,version)
    if not r:return {'status':'recipe_version_unmatched','steps':[]}
    result=[]
    for s in r['steps']:
        text=s['instruction'];action=s['action']
        result.append({'step_id':s['step_id'],'component_id':s['component_id'],'title':TITLES.get(action,text),'action':text,
          'completion': '完成本步后确认；传感器不能单独验证此步骤',
          'completion_mode':'explicit_confirmation','context':s.get('context',{}),
          'source':sources.get(s['source_id']), 'source_locator':s.get('source_locator'),
          'detail':r.get('garnish_source_text') if action=='garnish' else None})
    return {'status':'source_process_not_sensor_verified','steps':result,'ingredients':r['ingredients'],'branches':r.get('conditional_branches',[]),'open_issues':r.get('open_issues',[])}

def explain(result,recipe_id=None,recipe_version=None,stage_steps=None,quality=None):
    r,components,sources=context(recipe_id,recipe_version);bindings=stage_steps or {};groups={}
    for e in result.get('events',[]):
        if e['variable']=='f' and any(q.get('flags',{}).get('f') and q['start']<=e['end_s'] and q['end']>=e['start_s'] for q in (quality or [])):
            continue # Uncertain/short-window frequency cannot justify an operation-failure claim.
        direction=e['directions'][0] if len(e['directions'])==1 else 'mixed'
        key=(e['stage'],e['variable'],direction)
        groups.setdefault(key,[]).append(e)
    items=[]
    for (stage,ch,direction),events in groups.items():
        events=sorted(events,key=lambda e:e['start_s']);linked=next((s for s in r['steps'] if s['step_id']==bindings.get(stage)),None) if r else None
        labels={'T':'温度','f':'动作节奏','A':'动作幅度'}
        suffix={'high':'高于参考','low':'低于参考','mixed':'与参考有偏差','equal':'与参考相近'}
        observation=labels[ch]+suffix.get(direction,'与参考有偏差')
        advice='下次先核对原料、冰和起始温度是否与参考条件一致。'
        if ch=='f':advice={'high':'下一次把动作节奏放慢一些，观察是否接近参考。','low':'下一次把动作节奏加快一些，观察是否接近参考。'}.get(direction,'下一次保持动作连贯，观察节奏是否更接近参考。')
        if ch=='A':advice='下一次先保持与示范一致的握杯姿态，再对照动作幅度练习。'
        if not linked:advice='先确认本次操作阶段和参考条件，再针对该项偏差练习。'
        component=components.get(linked['component_id'],{}) if linked else {}
        effects=[x for x in component.get('effects',[]) if x.get('evidence_type')!='effect_not_quantified']
        identity=json.dumps([result.get('reference_id'),stage,ch,direction,events[0]['start_s']],ensure_ascii=False)
        items.append({'issue_id':'issue-'+hashlib.sha256(identity.encode()).hexdigest()[:16],
          'stage':stage,'channel':ch,'direction':direction,'start':events[0]['start_s'],'end':max(e['end_s'] for e in events),
          'intervals':[{'start':e['start_s'],'end':e['end_s']} for e in events],
          'observation':observation,'action':advice,'contribution':sum(e['contribution'] for e in events),
          'cause_status':'unconfirmed','effect_association':{'status':'source_context_only' if effects else 'not_established','claims':effects},
          'step_id':linked['step_id'] if linked else None,'component_id':linked['component_id'] if linked else None,
          'source':sources.get(linked['source_id']) if linked else None})
    items.sort(key=lambda i:(-i['contribution'],i['issue_id']))
    return {'issues':items[:3],'issue_count':len(items),'record_quality':quality or [],
      'reference_applicability':{'recipe_version_matched':r is not None,'conditions_verified':False,'status':'conditions_require_confirmation'},
      'known_limits':['短窗频率存在已知误判，频率偏差不等于确定的动作错误','动作幅度包含姿态变化影响，不能直接等同摇动用力大小']}
