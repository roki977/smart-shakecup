from pathlib import Path
import sys,json,hashlib,datetime
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'调酒算法'))
from denoise import temperature_trace
from curves import sampling_info
from 标准曲线 import ReferenceStore,recipe_version
source=ROOT/'白色佳人原始数据.json';data=json.loads(source.read_text());sha=hashlib.sha256(source.read_bytes()).hexdigest()
kb=json.loads((ROOT/'知识库.json').read_text());recipe=next(r for r in kb['recipes'] if r['id']=='iba-white-lady')
store=ReferenceStore();existing={r['id'] for r in store.list()};records=[];reports=[]
params={'window_s':.25,'tau_s':.15,'gap_s':.5}
for run in data['runs']:
    points={};duplicates=0
    for _,packet in run['rawPackets']:
        packet=json.loads(packet) if isinstance(packet,str) else packet
        for p in packet['temperature']:
            if p[0] in points:
                if points[p[0]]!=p:raise ValueError('conflicting temperature timestamp')
                duplicates+=1
            points[p[0]]=p
    raw=sorted(points.values());origin=raw[0][0]
    mean=[{'t':(p[0]-origin)/1e6,'value':(p[1]+p[2])/2,'valid':True} for p in raw]
    trace=temperature_trace(mean,**params)
    shown=temperature_trace(run['samples'],**params)
    rid='white-lady-'+run['id']+'-temperature-v1'
    artifact={'session_id':run['id'],'raw_temperature_columns':['device_us','probe_0_degC','probe_1_degC'],'raw_temperature':raw,'mean_temperature':mean,'filtered_temperature':trace['smoothed'],'display_trace_cleaning':shown,'processing':trace['processing'],'sampling':sampling_info([p['t'] for p in mean])}
    (ROOT/(rid+'.json')).write_text(json.dumps(artifact,ensure_ascii=False,indent=2))
    reference_points=[]
    for point in trace['smoothed']:
        if reference_points and point['t']-reference_points[-1]['t']>params['gap_s']:
            reference_points.append({'t':(point['t']+reference_points[-1]['t'])/2,'value':None,'valid':False})
        reference_points.append(point)
    record={'id':rid,'session_id':run['id'],'recipe_id':recipe['id'],'recipe_version':recipe_version(recipe),'bartender_id':'not_recorded_user_designated_reference','captured_at':run['createdAt'],'feature_version':'white-lady-temperature-median-ema-v1','origin':'measured','status':'approved',
      'conditions':{'device':run['device'],'recipe_name':run['recipeName'],'temperature_definition':'mean_of_two_probes_user_confirmed','ingredients_amounts':'not_recorded','ice':'not_recorded','cup_material':'not_recorded'},
      'review':{'reviewer_id':'user','reviewed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'basis':'用户指定两杯白色佳人为标准数据，并确认两个温度通道取平均。仅批准温度参考，不代表感官或全部动作指标验证。'},
      'curves':{'T':{'unit':'degC','time_unit':'s','points':reference_points},'f':None,'A':None},
      'processing':{'temperature_denoise':params,'version':'temperature-median-ema-v1','time_origin_us':origin,'time_source':'raw_temperature_device_us','input':'arithmetic_mean_of_probes'},
      'provenance':{'file':source.name,'sha256':sha,'run_id':run['id'],'detail_file':rid+'.json','capture':run['capture']},
      'limitations':['仅温度参考；f/A未重算，不能支持完整三通道评分','配方用量及冰况未记录，选用时需确认条件','采用原始设备时间轴，不使用网页duration、不拉伸时间','滤波用于标准温度；用户温度须使用相同双探头平均及滤波参数']}
    alignment_file=ROOT/'白色佳人时间对齐.json'
    if alignment_file.exists():record['time_alignment']=json.loads(alignment_file.read_text()).get(run['id'])
    record['evaluation_scope']='full_capture_temperature_reference_stage_start_unconfirmed'
    if rid not in existing:store.save(record)
    records.append(record)
    reports.append({'id':rid,'temperature_points':len(mean),'duration_device_s':mean[-1]['t'],'duration_web_s':run['duration'],'start_mean':mean[0]['value'],'end_mean':mean[-1]['value'],'display_invalid_removed':len(shown['rejected']),'duplicates':duplicates,'sampling':artifact['sampling']})
# Update catalog bindings without rebuilding or overwriting unrelated records.
for name,key in [('知识库.json','recipes'),('网站图鉴接口.json','catalog')]:
    path=ROOT/name;doc=json.loads(path.read_text());r=next(r for r in doc[key] if r['id']=='iba-white-lady')
    r['reference_binding']={'status':'measured_temperature_only','reference_ids':[v['id'] for v in records],'channels':{'T':{'unit':'degC'},'f':None,'A':None},'time_unit':'s'}
    if name=='网站图鉴接口.json':doc['references']=store.list(approved_only=True)
    path.write_text(json.dumps(doc,ensure_ascii=False,indent=2))
(ROOT/'白色佳人入库报告.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
print(json.dumps(reports,ensure_ascii=False,indent=2))
