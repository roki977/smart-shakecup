"""Build the source-backed knowledge graph. Pure stdlib; never derives sensor references."""
from pathlib import Path
from collections import Counter, defaultdict
import hashlib, json, csv, re
ROOT = Path(__file__).resolve().parent

def read(name): return json.loads((ROOT/name).read_text(encoding='utf-8'))
def write(name,data): (ROOT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def stable(prefix,value): return prefix+hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True).encode()).hexdigest()[:16]
def step(op,text,phase='finish',**context):return dict(action=op,instruction=text,phase=phase,context=context)

# Branches are alternatives/optional notes, NEVER silently appended to required main sequences.
BRANCHES={
 'Whiskey Sour':[{'condition':'使用蛋白','instruction':'来源要求更有力摇和以形成泡沫；并未要求干摇。'},{'condition':'选择带冰出品','instruction':'改用装冰古典杯；这是允许的出品分支。'}],
 'South Side':[{'condition':'使用可选蛋白','instruction':'按来源有力摇和。'}],
 'Black Russian':[{'condition':'选择 White Russian 变体','instruction':'上层加奶油，再慢搅；不将奶油加入 Black Russian 必选流程。'}],
 'Bellini':[{'condition':'选择 Puccini / Rossini / Tintoretto','instruction':'分别为橘汁 / 草莓泥 / 石榴汁变体，须另建配方版本。'}],
 'Caipirinha':[{'condition':'改用伏特加 / 朗姆 / Licor Beirao','instruction':'分别为 Caipiroska / Caipirissima / Caipirao，不与原版合并。'}],
 'Bloody Mary':[{'condition':'要求带冰出品','instruction':'来源另指定高球杯。'}],
 'Illegal':[{'condition':'选择 rocks','instruction':'可在传统陶杯中带冰出品。'}],
 'Irish Coffee':[{'condition':'用糖浆替代糖','instruction':'来源允许，须记录实际原料版本。'}],
 'John Collins':[{'condition':'改用 Old Tom Gin','instruction':'来源将此称为 Tom Collins。'}],
 'Kir':[{'condition':'白葡萄酒改为香槟','instruction':'Kir Royal 变体。'}],
 'Planters Punch':[{'condition':'按口味稀释','instruction':'来源允许水、冰或鲜果汁；不是单一固定稀释目标。'}],
 'Pina Colada':[{'condition':'选择历史/原料变体','instruction':'来源提及少量青柠以及鲜菠萝替代果汁；另存版本，不据此生成替换规则。'}],
 'Spritz':[{'condition':'改用 Campari / Cynar / Select','instruction':'来源允许其他版本，配方条件应分开。'}],
 'Ve.N.To':[{'condition':'蜂蜜混合液用洋甘菊浸液替代水','instruction':'来源列为可选变体。'}],
 'Horse’s Neck':[{'condition':'偏好苦精','instruction':'可加入数滴 Angostura。'}]
}
ISSUES={
 'Black Russian':['原文先在出品杯直接调配，后又过滤到同型装冰杯；需核实是否重复编辑。'],
 'New York Sour':['all ingredients 与最后 float wine 有范围歧义；不能据此认定用户提前加葡萄酒错误。'],
 'French 75':['方法段未明确摇和用冰，保持 unknown。'],
 'Pisco Punch':['方法段未明确摇和用冰，保持 unknown。'],
 'Moscow Mule':['方法段未明确加冰，不从常识补写。'],
 'Brandy Crusta':['mix 不自动等价于 stir；杯口准备来自 garnish 段，与 prepared glass 对应。'],
 "Dragon's Dream":['品牌介绍写 dirty-dump，方法写 strain；未消解前不把过滤方式用于自动判错。']
}

OBS={
 'shake':{'status':'candidate','inputs':['IMU'], 'limitation':'需验证动作识别；T/f/A不能证明冰是否存在、液体已混匀或摇和质量。'},
 'stir':{'status':'not_observable_reliably','inputs':[], 'limitation':'杯体可静止而吧勺运动；杯体IMU不能替代吧勺传感器。'},
 'add_ice':{'status':'not_observable_reliably','inputs':[], 'limitation':'温降或撞击不唯一对应加冰；需用户记录/外部事件。'},
 'default':{'status':'not_observable_reliably','inputs':[], 'limitation':'现有温度与杯体IMU无法唯一确认；需用户声明或其他经验证观测。'}
}

def effects(st,source):
 op=st['action'];ctx=st['context'];out=[]
 def claim(text,basis,refs):out.append({'description':text,'evidence_type':basis,'source_ids':refs,'quantitative_effect':None,'can_generate_score_target':False})
 if op=='shake' and ctx.get('ice')=='present':
  claim('带冰摇和属于冰液接触的降温过程；实际变化受配方和初始条件影响。','experiment_background',['arnold-part-1'])
  claim('摇和可能引入细小气泡；不等于已测得厚重度、混合度或好喝程度。','experiment_background',['arnold-part-2'])
 elif op=='shake' and ctx.get('ice')=='absent':
  claim('本元件处于已带冰摇和后的无冰阶段，目的是处理泡沫/质感；具体数值未经标定。' if ctx.get('prior_wet_shake') else '无冰摇和可用于发泡；适用于相应配方条件。','practitioner_technique',['difford-dry-shake','monin-dry-shake'])
 elif op in ('dissolve','muddle_dissolve'):
  claim('该步骤以原料溶解为流程目标；溶解完成不能由当前杯体传感器直接确认。','recipe_instruction',[source])
 elif op in ('muddle','muddle_dissolve'):
  claim('用于压碎原料并释放成分；目标与力度依原料和阶段而异，不由加速度唯一反推。','practitioner_technique',['difford-muddle'])
 elif op=='throw':
  claim('通过容器间拉倒使液体接触空气；此处为技法描述，非已标定感官或稀释结果。','practitioner_technique',['difford-throw'])
 elif op=='float':claim('在当前基底完成后单独加入上层原料；是否形成稳定分层取决于实际条件。','recipe_instruction',[source])
 elif op=='do_not_stir':claim('保留本配方末端已有层次，禁止在此处再搅拌。','recipe_instruction',[source])
 elif op=='add_ice':claim('改变所指容器的冰状态；在制备、润杯或出杯后的作用位置不同。','procedural_interpretation',[source])
 elif op in ('strain','double_strain','fine_strain'):claim('按配方过滤并转移；过滤方式及目的受上下文约束，不自动证明气泡被去除。','procedural_interpretation',[source])
 elif op=='express_peel':claim('将果皮油表达至饮品；留皮与弃皮是不同后续状态。','recipe_instruction',[source])
 else:claim('记录该位置的流程目的与状态变更；尚未建立可量化的感官因果关系。','effect_not_quantified',[source])
 return out

def main():
 audit=read('来源核验.json'); curated=read('IBA步骤整理.json');sup=read('补充来源.json')
 raw=read('IBA配方快照.json')['recipes']; checks={c['name']:c for c in audit['checks']}
 if set(curated)!={r['name'] for r in raw}:raise ValueError('IBA流程覆盖不一致')
 if set(audit['listing_urls'])!={r['source_url'] for r in raw}:raise ValueError('官网目录与快照不同：先补采新酒款，不静默沿用旧库')
 sources=[];recipes=[];nodes={};edges=[]
 def add_path(recipe_id, source_id, steps, path_id='main', locator='method'):
  output=[]
  for idx,st in enumerate(steps):
   # Component identity includes stage, local precondition AND relevant operation arguments.
   # Ordinal index alone is NOT its identity. Unspecified values are not guessed.
   ctx={'ice':'unknown','vessel':'unspecified',**st['context']}
   ctx['preceded_by']=steps[idx-1]['action'] if idx else 'start'
   identity={'action':st['action'],'phase':st['phase'],'context':ctx}
   cid=stable('component-',identity)
   node=nodes.setdefault(cid,{'id':cid,**identity,'label':st['instruction'],'effects':[], 'observability':OBS.get(st['action'],OBS['default']), 'occurrences':[]})
   occurrence={'recipe_id':recipe_id,'path_id':path_id,'step_index':idx+1,'source_id':source_id,'source_locator':st['context'].get('source_field',locator),'instruction':st['instruction']}
   node['occurrences'].append(occurrence)
   for e in effects(st,source_id):
    if e not in node['effects']:node['effects'].append(e)
   sid=f'{recipe_id}/{path_id}/{idx+1}'
   output.append({'step_id':sid,'component_id':cid,**st,'source_id':source_id,'source_locator':st['context'].get('source_field',locator),'sensor_confirmation_required':True})
   edges.append({'from':sid,'relation':'instance_of','to':cid,'source_id':source_id})
   if idx:edges.append({'from':output[idx-1]['step_id'],'relation':'precedes_in_this_recipe_version','to':sid,'source_id':source_id,'scope':recipe_id})
  return output
 def add_recipe(id,name,source,ingredients,steps,notes,branches=None,preps=None,garnish='',issues=None):
  ingredients=[({'source_text':x,'source_name':None,'amount_text':None,'abv':None,'sugar_concentration':None} if isinstance(x,str) else {'source_text':x['amount_and_role_summary'],'source_name':x['source_name'],'amount_text':x['amount_and_role_summary'],'abv':x.get('abv'),'sugar_concentration':x.get('sugar_concentration')}) for x in ingredients]
  recipe={'id':id,'name':name,'source_id':source,'ingredients':ingredients,'ingredient_data_status':'source_recipe_not_sensor_measurement','garnish_source_text':garnish,'steps':add_path(id,source,steps),'notes':notes,'conditional_branches':branches or [],'ingredient_scope':'保留来源名称及原单位用量；未进行跨品牌同一性映射，不供自动替换/ABV推算','ingredient_preparations':[],'open_issues':issues or [],'reference_curves':None,'diagnosis_ready':False,'review_status':'source_read_structured_by_assistant_not_bartender_validated'}
  for i,p in enumerate(preps or []):recipe['ingredient_preparations'].append({'name':p['name'],'steps':add_path(id,source,p['steps'],f'prep-{i+1}','ingredient preparation note')})
  recipes.append(recipe)
 for r in raw:
  slug=r['source_url'].strip('/').split('/')[-1];sid='iba-'+slug;ch=checks[r['name']]
  if ch['status']!='ok' or ch.get('method_changed'):raise ValueError(f"来源变更/采集失败，需重新复核：{r['name']}")
  for field in ('ingredients_text','method_text','garnish_text'):
   normalize=lambda text:re.sub(r'\s+',' ',text).strip()
   if normalize(ch['fields'].get(field,''))!=normalize(r.get(field,'')):raise ValueError(f'来源字段已变化：{sid}/{field}')
  sources.append({'id':sid,'publisher':'IBA','kind':'official_recipe','url':r['source_url'],'checked_at':ch['checked_at'],'verification':'live_method_matches_snapshot','sha256_method':hashlib.sha256(r['method_text'].encode()).hexdigest(),'locator':'Ingredients / Method / Garnish'})
  steps=list(curated[r['name']]);g=r['garnish_text'].strip(); notes=[]
  if re.search(r'\bnote\s*:',r['method_text'],re.I):notes.append('来源含注释/变体，原文保留在快照；已建分支见 conditional_branches，未结构化细节不参与自动判错。')
  if r['name']=='Brandy Crusta':
   steps=[step('rim','柑橘润杯口后蘸糖','preparation',source_field='garnish'),step('garnish','柑橘皮卷入杯内','preparation',source_field='garnish')]+steps
  elif r['name']=='Margarita':
   # optional prep is a branch, never made mandatory.
   pass
  elif r['name'] in ('Dry Martini','French Martini'):
   steps.append(step('express_peel','柠檬皮挤油；Dry Martini 可改用橄榄分支' if r['name']=='Dry Martini' else '柠檬皮挤油至饮品','finish',source_field='garnish',optional=r['name']=='Dry Martini'))
  elif g and not g.lower().startswith('n/a'):
   steps.append(step('garnish','依该版本 Garnish 字段完成装饰；可选性和替代项保留来源措辞','finish',source_field='garnish',optional='optional' in g.lower()))
  branches=list(BRANCHES.get(r['name'],[]))
  if r['name']=='Margarita':branches.append({'condition':'选择盐口装饰','instruction':'半圈盐口为可选；应在装酒前准备。'})
  if r['name']=='Dry Martini':branches.append({'condition':'要求橄榄装饰','instruction':'可用青橄榄替代柠檬皮挤油，非两个必做步骤。'})
  if g.lower().startswith('n/a') and 'optional' in g.lower():branches.append({'condition':'选择可选装饰','instruction':g})
  add_recipe(sid,r['name'],sid,r['ingredients_text'].splitlines(),steps,notes,branches,garnish=g,issues=ISSUES.get(r['name'],[]))
 for r in sup['recipes']:
  sources.append({'id':r['id'],'publisher':'Death & Co' if r['id'].startswith('dc-') else ('Difford’s Guide' if r['id'].startswith('difford-') else 'Imbibe / PDT attributed recipe'),'kind':'creator_recipe','url':r['url'],'author':r['author'],'checked_at':r['collected_on'],'verification':r['verification'],'locator':r['source_section']})
  add_recipe(r['id'],r['name'],r['id'],r.get('ingredient_items',r['ingredients']),r['steps'],r['notes'],preps=r['ingredient_preparations'],issues=ISSUES.get(r['name'],[]))
 sources+=sup['technique_sources']
 # Generic dry-shake knowledge exists even if the IBA recipe routes don't use forward dry shaking.
 techniques=[{'id':'tech-forward-dry','name':'正向干摇（技术路线，非特定酒款标准）','source_ids':['difford-dry-shake','monin-dry-shake'],'steps':add_path('tech-forward-dry','difford-dry-shake',[step('shake','含发泡原料的液体先无冰摇和','main',ice='absent',prior_wet_shake=False,ingredients='foaming_recipe'),step('add_ice','干摇后加冰','main',after='dry_shake',before='wet_shake'),step('shake','再带冰摇和','main',ice='present',prior_dry_shake=True)],locator='dry shake technique')}]
 techniques.append({'id':'tech-throw','name':'冷饮拉倒（含重复循环，非所有配方必选）','source_ids':['difford-throw'],'steps':add_path('tech-throw','difford-throw',[step('load','一侧容器装原料与冰','preparation',ice='present',vessel='upper_tin'),step('retain_ice','滤器在该容器中留冰','preparation',vessel='upper_tin'),step('throw','将液体向另一容器拉倒','main',vessel='two_tins',ice='retained_in_upper_tin'),step('return_to_iced_tin','倒回原先有冰的容器，可再重复拉倒','main',vessel='upper_tin')],locator='How to throw')})
 edges.append({'from':'tech-throw/main/4','relation':'may_repeat','to':'tech-throw/main/3','source_id':'difford-throw','stop_condition':'recipe_or_practitioner_defined_not_sensor_calibrated'})
 branch_nodes=[]
 for r in recipes:
  for i,b in enumerate(r['conditional_branches']):
   bid=f"{r['id']}/branch/{i+1}"
   branch_nodes.append({'id':bid,**b,'source_id':r['source_id'],'status':'textual_branch_not_executable_subpath'})
   edges.append({'from':r['id'],'relation':'has_conditional_branch','to':bid,'source_id':r['source_id']})
  for prep in r['ingredient_preparations']:
   edges.append({'from':r['id'],'relation':'requires_prepared_ingredient','to':prep['steps'][0]['step_id'],'source_id':r['source_id']})
 byname=defaultdict(list)
 for r in recipes:byname[r['name']].append(r['id'])
 for ids in byname.values():
  for a,b in zip(ids,ids[1:]):edges.append({'from':a,'relation':'same_named_drink_different_source_version','to':b,'merge_allowed':False})
 kb={'schema_version':'0.1.0','built_from_checked_date':audit['checked_at'],'scope':'IBA当前102款全目录流程基线 + 15个公开补充配方版本 + 6篇技术/实验来源；非全行业穷尽','sources':sources,'recipes':recipes,'technique_paths':techniques,'branch_nodes':branch_nodes,'components':list(nodes.values()),'edges':edges,'diagnosis_rules':[], 'evidence_policy':{'unknown_is_not_false':True,'process_source_is_not_sensor_reference':True,'a_t_is_not_mixing_degree':True,'f_A_are_backend_features_not_KB_facts':True,'recipe_sequence_is_not_proof_of_causal_taste':True,'no_default_shake_seconds':True},'uncollected_channels':sup['uncollected_channels']}
 kb['coverage']={'iba_catalog':len(raw),'iba_live_checked':len(checks),'recipe_versions':len(recipes),'unique_drink_names':len(byname),'supplemental_recipe_versions':len(sup['recipes']),'technique_sources':len(sup['technique_sources']),'contextual_components':len(nodes),'graph_edges':len(edges),'recipe_names_with_multiple_sources':{k:v for k,v in byname.items() if len(v)>1},'recipes_with_open_source_issues':len([r for r in recipes if r['open_issues']]),'verified_numeric_reference_curves':0,'validated_diagnosis_rules':0,'per_drink_10_to_20_sources_achieved':False}
 # Keep measured data in a separate store so rebuilding source knowledge never erases it.
 import importlib.util
 spec=importlib.util.spec_from_file_location('references',ROOT/'标准曲线.py');ref=importlib.util.module_from_spec(spec);spec.loader.exec_module(ref)
 records=ref.ReferenceStore(ROOT).list()
 for r in recipes:
  r['recipe_version']=ref.recipe_version(r)
  r['reference_binding']={'status':'awaiting_measurement','reference_ids':[], 'channels':{'T':{'unit':'degC'},'f':{'unit':'Hz'},'A':{'unit':'m/s2','definition':'effective acceleration RMS, not displacement'}},'time_unit':'s'}
  matching=[x for x in records if x['recipe_id']==r['id'] and x['recipe_version']==r['recipe_version']]
  r['reference_binding']['reference_ids']=[x['id'] for x in matching]
  if matching:r['reference_binding']['status']='approved_available' if any(x['status']=='approved' for x in matching) else 'pending_review'
 kb['schema_version']='0.2.0'
 kb['coverage']['verified_numeric_reference_curves']=sum(x['status']=='approved' for x in records)
 write('知识库.json',kb)
 write('网站图鉴接口.json',{'schema_version':'1.0','catalog':recipes,'sources':sources,'components':list(nodes.values()),'references':records,'reference_policy':'Only matching recipe_version and conditions, reviewed measured data may be selected. Never infer curves from text.'})
 with (ROOT/'酒款覆盖.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['酒款','版本ID','来源','步骤数','同名来源数','来源疑点','数值参考曲线','可自动判错'])
  source_map={s['id']:s for s in sources}
  for r in recipes:w.writerow([r['name'],r['id'],source_map[r['source_id']]['url'],len(r['steps']),len(byname[r['name']]),'；'.join(r['open_issues']),'无','否'])
 print(json.dumps(kb['coverage'],ensure_ascii=False,indent=2))
if __name__=='__main__':main()
