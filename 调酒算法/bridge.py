"""HTTP/UI boundary, separate from numerical engine."""
from engine import Engine,features
from curves import sensor_curves
from feedback import steps,explain
import time

class PacketDecoder:
    def __init__(self,epoch_ms,acc_unit,packet_time,probe):
        if acc_unit not in ('g','m/s2') or packet_time not in ('first','last'):raise ValueError('declare acceleration unit and packet timestamp semantics')
        self.epoch=epoch_ms;self.factor=9.80665 if acc_unit=='g' else 1.;self.anchor=packet_time;self.probe=probe;self.last_imu=-1.;self.last_temp=-1.
    def decode(self,p):
        t=(p['ms']-self.epoch)/1000;acc=p.get('acc',[]);hz=p.get('acc_hz');imu=[]
        if acc and (not hz or hz<=0):raise ValueError('raw acceleration needs acc_hz')
        for i,a in enumerate(acc):
            at=t+(i if self.anchor=='first' else i-len(acc)+1)/hz
            if at<=self.last_imu:raise ValueError('overlapping/reversed IMU timestamps; check packet_time')
            imu.append(dict(t=at,ax=a[0]*self.factor,ay=a[1]*self.factor,az=a[2]*self.factor,valid=p.get('ok',True)));self.last_imu=at
        # For 15Hz temperature in 10Hz packets send timestamped temperature_samples.
        samples=p.get('temperature_samples',[{'ms':p['ms'],'value':p.get('temp')}]);temp=[]
        for s in samples:
            at=(s['ms']-self.epoch)/1000;v=s['value'];v=v[self.probe] if isinstance(v,list) else v
            if at<=self.last_temp:continue # repeated sample is not a new observation
            temp.append({'t':at,'value':v,'valid':v is not None and p.get('ok',True)});self.last_temp=at
        return imu,temp

def event(e,end):
    return {'id':e['id'],'start':e['start_s'],'end':e.get('end_s',end),'phase':e['stage'],'variable':e['variable'],'direction':'mixed' if len(e['directions'])>1 else e['directions'][0], 'title':e['variable']+'超出参考容差','reliability':'measured_deviation','causeStatus':'unconfirmed','detail':'只确认数据偏差，具体操作原因未判定'}

class Session:
    def __init__(self,payload):
        self.recipe_id=payload.get('recipe_id');self.stage_steps=payload.get('stage_steps',{});self.quality=[]
        self.e=Engine(payload['algorithm'],payload['reference']);self.e.start(payload.get('start_t',0));self.source=payload['source']
        if self.source not in ('measured','simulated','replay'):raise ValueError('source required')
        self.fc=payload.get('feature_config');self.decoder=PacketDecoder(**payload['device']) if 'device' in payload else None
        self.imu=[];self.temp=[];self.frames=[];self.raw=[];self.received=None;self.result=None
    def ingest(self,p):
        if self.result is not None:return self.result
        if 'packet' in p:
            if self.decoder is None or self.fc is None:raise ValueError('device and feature config required')
            raw=p['packet'];ii,tt=self.decoder.decode(raw);self.imu+=ii;self.temp+=tt
            self.raw.append({'receivedAt':time.time()*1000,'payload':raw});ff=features(self.imu,self.temp,self.fc)
        else:ff=p['frames']
        for f in ff:
            if f['t']>self.e.last_t:
                flags={k:v for k,v in f.get('quality',{}).items() if v!='valid'}
                if flags:
                    if self.quality and self.quality[-1]['flags']==flags and f['t']-self.quality[-1]['end']<=self.e.cfg['max_frame_gap_s']:
                        self.quality[-1]['end']=f['t']
                    else:self.quality.append({'start':f['t'],'end':f['t'],'flags':flags,'message':'这段记录的可靠性需要留意，不能直接归因于操作错误'})
                self.e.push(f);self.frames.append(self.snapshot(stale=False))
        self.received=time.monotonic()
        return self.snapshot()
    def snapshot(self,stale=True):
        r=self.e.rows[-1] if self.e.rows else {'t':self.e.last_t,'metrics':{},'current_score':None}
        is_stale=stale and self.received is not None and time.monotonic()-self.received>1.5 and self.result is None
        fs={}
        for j,u in [('T','°C'),('f','Hz'),('A','m/s²')]:
            m=r['metrics'].get(j,{});ok=m.get('valid',False) and not is_stale
            direction=m.get('direction','unknown');direction='within' if m.get('q')==0 else direction
            if direction not in ('low','within','high'):direction='unknown'
            fs[j]={'value':m.get('value') if ok else None,'unit':u,'at':r['t'],'state':'stale' if is_stale else 'valid' if ok else 'unknown','coverage':1 if ok else 0,'direction':direction,'reference':m.get('reference'),'pointRange':None}
        enough=self.e.stage_index==len(self.e.cfg['stages'])-1 and r['t']-self.e.phase_start>=self.e.phase['end_s']-1e-8
        val=r['current_score'] if not is_stale else None
        return {'preparation':steps(self.recipe_id,self.e.cfg['recipe_version']),'recordQuality':self.quality,'scoreMapping':self.e.score_mapping,'scoringPolicy':self.e.scoring_policy,'schemaVersion':'1.0','source':self.source,'t':r['t'],'connection':'lost' if is_stale else 'online' if self.e.rows else 'waiting','ruleVersion':self.e.cfg['version'],'phase':{'id':self.e.phase['id'],'label':self.e.phase['id'],'evidence':'explicit_stage_event','canFinish':enough and val is not None and not is_stale},'features':fs,'current':{'value':val,'status':'valid' if val is not None else 'waiting','reason':'当前窗口符合度' if val is not None else '等待完整有效数据'},'hint':{'title':'按当前阶段操作','detail':'数据偏差与操作原因分别处理','evidence':[],'condition':'所选配方和参考条件适用'},'events':[event(e,r['t']) for e in r.get('active_events',[])]}
    def finish(self,intent):
        if self.result is not None:return self.result
        if intent not in ('complete','partial'):raise ValueError('invalid finish intent')
        import copy
        preview=copy.deepcopy(self.e).finish(self.e.last_t)
        if intent=='complete' and not preview['complete']:raise ValueError('completion conditions not met; choose partial')
        r=self.e.finish(self.e.last_t);complete=r['complete'] and intent=='complete'
        self.result={'completed':complete,'status':'complete' if complete else 'partial','source':self.source,'ruleVersion':r['rule_version'],'reference':r['reference_id'],'final':{'value':r['final_score'] if complete else None,'status':'valid' if complete else 'unrated','reason':'本次参考符合度' if complete else r['assessment']['message']},'frames':self.frames,'events':[event(e,self.e.last_t) for e in r['events']],'raw':self.raw}
        self.result['guidance']=explain(r,self.recipe_id,self.e.cfg['recipe_version'],self.stage_steps,self.quality)
        self.result['preparation']=steps(self.recipe_id,self.e.cfg['recipe_version'])
        self.result['scoreMapping']=r['score_mapping']
        self.result['effectiveConfig']=r['effective_config']
        self.result['featureConfig']=self.fc
        self.result['sensorCurves']=sensor_curves(self.imu,self.temp)
        self.result['assessment']=r['assessment']
        self.result['scoringPolicy']=r['scoring_policy']
        return self.result
