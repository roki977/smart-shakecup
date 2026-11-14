"""Deterministic T/f/A feature extraction, stage handling, scoring and events.
Times: seconds; acceleration: m/s². No AI calls, no taste/causal inference.
"""
from dataclasses import dataclass, asdict
from copy import deepcopy
import math
import numpy as np

CHANNELS=('T','f','A')

def ahp(r1,r2):
    if r1<=0 or r2<=0: raise ValueError('AHP ratios must be positive')
    return dict(zip(CHANNELS,(r1/(1+r1),r2/((1+r1)*(1+r2)),1/((1+r1)*(1+r2)))))

def score(loss,anchor_loss,anchor_score):
    if anchor_loss<=0 or not 0<anchor_score<100:raise ValueError('invalid score anchor')
    return 100*math.exp(math.log(anchor_score/100)*loss/anchor_loss)

@dataclass
class FeatureConfig:
    version:str
    window_s:float
    hop_s:float
    resample_hz:float
    max_imu_gap_s:float
    max_temperature_age_s:float
    highpass_hz:float
    frequency_min_hz:float
    frequency_max_hz:float
    rest_rms:float
    min_autocorrelation:float
    min_spectral_concentration:float
    harmonic_tolerance:float

def features(imu,temperature,cfg):
    settings=asdict(cfg) if isinstance(cfg,FeatureConfig) else deepcopy(cfg)
    recovery=settings.pop('recovery_window_s',None)
    frames=_features(imu,temperature,settings)
    if recovery is None:return frames
    if not 0<recovery<settings['window_s']:raise ValueError('invalid recovery window')
    shorter=dict(settings,window_s=recovery)
    short={round(f['t'],8):f for f in _features(imu,temperature,shorter)}
    for f in frames:
        candidate=short.get(round(f['t'],8))
        if f['motion']=='aperiodic' and candidate and candidate['motion']=='periodic':
            f['f']=candidate['f'];f['quality']['f']='valid_short_window'
            f['frequency_window']=candidate['window'];f['motion']='periodic_short_window'
    return frames

def _features(imu,temperature,cfg):
    """Replay or cumulative streaming buffer -> causal frames. Rows IMU t,ax,ay,az,valid;
    temperature t,value,valid. Output A is high-pass filtered vector RMS.
    Caller appends only new frames for streaming. No future sample is used for a frame.
    """
    c=cfg if isinstance(cfg,FeatureConfig) else FeatureConfig(**cfg)
    if not imu:return []
    times=np.array([r['t'] for r in imu],float)
    if np.any(np.diff(times)<=0):raise ValueError('IMU timestamps must increase')
    temp_times=[r['t'] for r in temperature]
    if any(b<=a for a,b in zip(temp_times,temp_times[1:])):raise ValueError('temperature timestamps must increase')
    xyz=np.array([[r[k] for k in ('ax','ay','az')] for r in imu],float)
    valid=np.array([r.get('valid',True) for r in imu]) & np.isfinite(xyz).all(axis=1)
    # Causal first-order high-pass; reset at a missing interval. No claim of gravity removal.
    filtered=np.zeros_like(xyz)
    for i in range(1,len(imu)):
        dt=times[i]-times[i-1]
        if valid[i] and valid[i-1] and dt<=c.max_imu_gap_s:
            alpha=math.exp(-2*math.pi*c.highpass_hz*dt)
            filtered[i]=alpha*(filtered[i-1]+xyz[i]-xyz[i-1])
    result=[]
    count=int(math.floor((times[-1]-times[0])/c.hop_s+1e-8))+1
    for n in range(count):
        t=float(times[0]+n*c.hop_s);left=t-c.window_s
        out={'t':t,'T':None,'f':None,'A':None,'motion':'warming_up','feature_version':c.version,'window':[max(float(times[0]),left),t],'quality':{}}
        ti=np.searchsorted(temp_times,t+1e-9,side='right')-1
        if ti>=0:
            tr=temperature[ti]
            if tr.get('valid',True) and tr['value'] is not None and math.isfinite(tr['value']) and t-tr['t']<=c.max_temperature_age_s:out['T']=tr['value']
        out['quality']['T']='valid' if out['T'] is not None else 'missing_or_stale'
        if left<times[0]-1e-8:
            out['quality'].update(f='warming_up',A='warming_up');result.append(out);continue
        lo=max(0,np.searchsorted(times,left,side='right')-1);hi=np.searchsorted(times,t+1e-9,side='right')
        ts=times[lo:hi]
        if len(ts)<3 or t-ts[-1]>c.max_imu_gap_s or np.max(np.diff(ts))>c.max_imu_gap_s or not valid[lo:hi].all():
            out['motion']='data_gap';out['quality'].update(f='data_gap',A='data_gap');result.append(out);continue
        # Uniform grid ends at latest available IMU sample; never extrapolate across time.
        grid=np.arange(left,ts[-1]+1e-9,1/c.resample_hz)
        u=np.column_stack([np.interp(grid,ts,filtered[lo:hi,k]) for k in range(3)])
        u-=np.mean(u,axis=0)
        amplitude=float(np.sqrt(np.mean(np.sum(u*u,axis=1))))
        out['A']=amplitude;out['quality']['A']='valid'
        if amplitude<c.rest_rms:
            out.update(f=0.,motion='low_motion');out['quality']['f']='no_cycle_low_motion';result.append(out);continue
        N=len(u);nfft=4*2**math.ceil(math.log2(N))
        power=np.sum(abs(np.fft.rfft(u*np.hanning(N)[:,None],n=nfft,axis=0))**2,axis=1)
        freq=np.fft.rfftfreq(nfft,1/c.resample_hz)
        band=(freq>=c.frequency_min_hz)&(freq<=c.frequency_max_hz)
        ids=np.where(band)[0];peak=ids[np.argmax(power[ids])];spectral=float(freq[peak])
        # Energy within one actual-window frequency bin, not one zero-padded bin.
        near=abs(freq-spectral)<=1/c.window_s
        concentration=float(power[near].sum()/max(power[band].sum(),1e-15))
        lag0=max(2,int(c.resample_hz/c.frequency_max_hz));lag1=min(N-2,int(c.resample_hz/c.frequency_min_hz))
        corr={}
        for lag in range(max(1,lag0-1),lag1+2):
            a,b=u[:-lag],u[lag:];corr[lag]=float(np.sum(a*b)/max(np.sqrt(np.sum(a*a)*np.sum(b*b)),1e-15))
        peaks=[lag for lag in range(lag0,lag1+1) if corr[lag]>=corr[lag-1] and corr[lag]>=corr[lag+1] and corr[lag]>=c.min_autocorrelation]
        candidates=[]
        for lag in peaks:
            f=c.resample_hz/lag;ratio=spectral/f
            if min(abs(ratio-h) for h in (1,2,3))<=c.harmonic_tolerance:candidates.append(lag)
        if candidates and concentration>=c.min_spectral_concentration:
            best=max(corr[k] for k in candidates)
            lag=min(k for k in candidates if corr[k]>=best-.05)
            ym,y,yp=corr[lag-1],corr[lag],corr[lag+1];den=ym-2*y+yp
            offset=.5*(ym-yp)/den if abs(den)>1e-12 else 0.
            out.update(f=float(c.resample_hz/(lag+np.clip(offset,-.5,.5))),motion='periodic');out['quality']['f']='valid'
        else:out.update(motion='aperiodic');out['quality']['f']='unclear_cycle'
        result.append(out)
    return result

def interpolate(points,t,max_gap):
    """No extrapolation; points have t,value,valid. Values are stage-relative."""
    ts=[p['t'] for p in points];i=int(np.searchsorted(ts,t))
    if i<len(points) and abs(ts[i]-t)<1e-8:
        p=points[i];return p['value'] if p.get('valid',True) else None
    if i>0 and abs(ts[i-1]-t)<1e-8:
        p=points[i-1];return p['value'] if p.get('valid',True) else None
    if i==0 or i==len(points):return None
    a,b=points[i-1],points[i]
    if not a.get('valid',True) or not b.get('valid',True) or b['t']-a['t']>max_gap:return None
    return a['value']+(b['value']-a['value'])*(t-a['t'])/(b['t']-a['t'])

def calibrate_tolerance(independent_rmse,noise_floor,quantile):
    """Rows are independent approved sessions, columns stage-relative error windows.
    Template self-comparisons must be excluded by the caller. Never fed live user errors.
    """
    x=np.asarray(independent_rmse,float)
    if x.ndim!=2 or len(x)<2 or not np.isfinite(x).all() or (x<0).any():raise ValueError('need independent finite nonnegative RMSE records')
    return np.maximum(noise_floor,np.quantile(x,quantile,axis=0)).tolist()

class Engine:
    def __init__(self,config,reference):
        self.cfg=deepcopy(config);self.ref=deepcopy(reference)
        self.scoring_policy=config['scoring_policy']
        self.score_mapping=config.get('score_mapping','exponential-v2')
        if self.score_mapping not in ('exponential-v2','reciprocal-v2'):raise ValueError('unknown score mapping')
        if self.scoring_policy not in ('legacy-v1','tolerance-excess-v2'):raise ValueError('unknown scoring policy')
        # v2: one tolerance of sustained excess in all channels gives 50 points.
        # Product-scale anchor, not a sensory calibration.
        self.score_anchor=(config['anchor_loss'],config['anchor_score']) if self.scoring_policy=='legacy-v1' else (1.,50.)
        if config['feature_version']!=reference['feature_version']:raise ValueError('feature versions differ')
        if config['recipe_version']!=reference['recipe_version']:raise ValueError('recipe versions differ')
        self.weights=ahp(config['r1'],config['r2']);self.state='ready';self.stage_index=-1
        self.events=[];self.rows=[];self.loss=0.;self.completed=[];self.frozen=None;self.serial=0
        if not math.isclose(sum(p['beta'] for p in config['stages']),1):raise ValueError('stage weights must sum to one')
        for p in config['stages']:
            if p['end_s']<=p['evaluate_from_s']:raise ValueError('empty evaluation period')
            for j in p['channels']:
                if p['scale'][j]<=0:raise ValueError('scale must be positive')
    def _score(self,loss):
        return 100/(1+loss) if self.score_mapping=='reciprocal-v2' else score(loss,*self.score_anchor)
    def start(self,t):
        if self.state!='ready':raise ValueError('already started')
        self.state='running';self._enter(0,t)
    def _enter(self,index,t):
        self.stage_index=index;self.phase=self.cfg['stages'][index];self.phase_start=t;self.last_t=t
        self.history={j:[] for j in self.phase['channels']};self.active={};self.valid_time=0.;self.observed_time=0.;self.phase_loss=0.
    def _close(self,j,t,reason):
        e=self.active.pop(j,None)
        if e and e['confirmed']:
            e['end_s']=t;e['close_reason']=reason;e.pop('recovery_start',None);self.events.append(e)
    def pause(self,t):
        if self.state!='running':raise ValueError('not running')
        if t<self.last_t:raise ValueError('pause precedes last frame')
        for j in list(self.active):self._close(j,t,'interrupted')
        self.state='paused';self.pause_t=t
    def resume(self,t):
        if self.state!='paused':raise ValueError('not paused')
        if t<self.pause_t:raise ValueError('resume precedes pause')
        # Clock is not shifted. A pause cannot erase elapsed reference time.
        self.state='running';self.last_t=t;self.history={j:[] for j in self.phase['channels']}
    def transition(self,t,evidence):
        if self.state!='running' or evidence not in ('confirmed','validated_event'):raise ValueError('transition needs confirmed evidence')
        if self.stage_index+1>=len(self.cfg['stages']):raise ValueError('last stage: finish instead')
        if t<self.last_t:raise ValueError('transition precedes last frame')
        self._end_phase(t)
        self._enter(self.stage_index+1,t)
    def _end_phase(self,t):
        for j in list(self.active):self._close(j,t,'stage_end')
        duration=self.phase['end_s']-self.phase['evaluate_from_s']
        self.completed.append({'stage':self.phase['id'],'duration_met':t-self.phase_start>=self.phase['end_s']-1e-8,'coverage':min(1.,self.valid_time/max(duration,t-self.phase_start-self.phase['evaluate_from_s'])),'loss':self.phase_loss})
    def push(self,frame):
        if self.state!='running':return {'state':self.state,'accepted':False}
        t=frame['t'];local=t-self.phase_start
        if t<=self.last_t:raise ValueError('frame timestamps must increase')
        start=max(self.last_t-self.phase_start,self.phase['evaluate_from_s']);dt=max(0.,local-start);self.last_t=t
        if frame.get('feature_version')!=self.cfg['feature_version']:raise ValueError('frame feature version differs')
        row={'t':t,'stage':self.phase['id'],'phase_t':local,'metrics':{},'current_score':None,'loss_total':self.loss,'quality':'warming_up'}
        if not dt:self.rows.append(row);return deepcopy(row)
        p=self.phase;duration=p['end_s']-p['evaluate_from_s'];valid=True;terms={}
        for j in p['channels']:
            value=frame.get(j);ref=interpolate(self.ref['stages'][p['id']][j],local,self.cfg['reference_max_gap_s'])
            ok=value is not None and ref is not None and math.isfinite(value) and dt<=self.cfg['max_frame_gap_s']
            residual=value-ref if ok else None
            self.history[j].append((local-dt,local,residual))
            cut=max(p['evaluate_from_s'],local-self.cfg['error_window_s'])
            self.history[j]=[seg for seg in self.history[j] if seg[1]>cut]
            segments=[(max(0.,b-max(a,cut)),r) for a,b,r in self.history[j]]
            denom=sum(d for d,r in segments if r is not None);span=local-cut
            ready=ok and denom>=span*self.cfg['window_min_coverage']-1e-9
            if not ready:
                valid=False;self._close(j,t,'data_gap');row['metrics'][j]={'valid':False,'residual':residual};continue
            mse=sum(d*r*r for d,r in segments if r is not None)/denom;rmse=math.sqrt(mse)
            b=p['tolerance'][j];b=interpolate(b,local,self.cfg['reference_max_gap_s']) if isinstance(b,list) else b
            if b is None or b<=0:raise ValueError('tolerance must be positive and cover evaluated time')
            q=max(rmse-b,0)/(p['scale'][j] if self.scoring_policy=='legacy-v1' else b);terms[j]=self.weights[j]*q*q
            positive=sum(d for d,r in segments if r is not None and r>0)/denom
            negative=sum(d for d,r in segments if r is not None and r<0)/denom
            direction='mixed' if min(positive,negative)>.2 else ('high' if positive>negative else 'low' if negative>positive else 'equal')
            row['metrics'][j]={'valid':True,'value':value,'reference':ref,'residual':residual,'mse':mse,'rmse':rmse,'tolerance':b,'q':q,'direction':direction}
            contribution=p['beta']*terms[j]*dt/duration
            self._event(j,t,dt,rmse/b,q,contribution,direction)
        # Preserve known channel losses even during partial data; never renormalize missing weights.
        delta=p['beta']*sum(terms.values())*dt/duration;self.loss+=delta;self.phase_loss+=delta
        if valid:
            self.valid_time+=dt;row['current_score']=self._score(sum(terms.values()))
        row.update(loss_total=self.loss,quality='valid' if valid else 'incomplete',active_events=[deepcopy(e) for e in self.active.values() if e['confirmed']],rule_version=self.cfg['version'],reference_id=self.ref['id']);self.rows.append(row);return deepcopy(row)
    def _event(self,j,t,dt,h,q,contribution,direction):
        e=self.active.get(j)
        if h>1:
            if e is None:
                self.serial+=1;e={'id':f'e{self.serial}','variable':j,'stage':self.phase['id'],'start_s':t-dt,'confirmed':False,'over_s':0.,'contribution':0.,'peak_ratio':h,'directions':[],'recovery_start':None};self.active[j]=e
            e['over_s']+=dt;e['contribution']+=contribution;e['peak_ratio']=max(e['peak_ratio'],h);e['recovery_start']=None
            if direction not in e['directions']:e['directions'].append(direction)
            e['confirmed']=e['confirmed'] or e['over_s']>=self.cfg['on_s']-1e-9
        elif e:
            if not e['confirmed']:self.active.pop(j);return
            if h<self.cfg['recovery_ratio']:
                if e['recovery_start'] is None:e['recovery_start']=t-dt
                if t-e['recovery_start']>=self.cfg['off_s']-1e-9:self._close(j,e['recovery_start'],'recovered')
            else:e['recovery_start']=None
    def finish(self,t,confirmed=True):
        if self.frozen is not None:return deepcopy(self.frozen)
        if self.state not in ('running','paused'):raise ValueError('not started')
        if not confirmed:raise ValueError('completion needs confirmation')
        if t<self.last_t:raise ValueError('finish precedes last frame')
        self._end_phase(t)
        complete=len(self.completed)==len(self.cfg['stages']) and all(p['duration_met'] and p['coverage']>=self.cfg['final_min_coverage']-1e-9 for p in self.completed)
        # Merge same-channel events only across observed recovery, never across a data gap.
        merged=[]
        for e in sorted(self.events,key=lambda e:(e['stage'],e['variable'],e['start_s'])):
            if merged and merged[-1]['stage']==e['stage'] and merged[-1]['variable']==e['variable'] and merged[-1]['close_reason']=='recovered' and e['start_s']-merged[-1]['end_s']<=self.cfg['merge_gap_s']:
                prev=merged[-1];prev['end_s']=e['end_s'];prev['contribution']+=e['contribution'];prev['over_s']+=e['over_s'];prev['peak_ratio']=max(prev['peak_ratio'],e['peak_ratio']);prev['directions']=sorted(set(prev['directions']+e['directions']));prev['close_reason']=e['close_reason']
            else:merged.append(deepcopy(e))
        ordered=sorted(merged,key=lambda e:-e['contribution'])
        self.state='finished';self.frozen={'state':'finished','complete':complete,'final_score':self._score(self.loss) if complete else None,'loss':self.loss,'stages':self.completed,'events':ordered,'feedback_events':ordered[:self.cfg['feedback_limit']],'rule_version':self.cfg['version'],'reference_id':self.ref['id'],'parameter_status':self.cfg['parameter_status'],'issues':[] if complete else ['required_stage_duration_or_data_coverage_incomplete']}
        self.frozen.update(scoring_policy=self.scoring_policy, score_mapping=self.score_mapping, display_name='操作符合度', effective_config=deepcopy(self.cfg), score_meaning='reference_conformity',
            scoring_calibration='product_policy_not_sensory_validated' if self.scoring_policy!='legacy-v1' else self.cfg['parameter_status'],
            assessment={'evaluation_complete':complete,'confirmed_deviation':bool(ordered),
                'message':('已确认偏离参考；完整评分不可用' if ordered else '证据不足，不能判定表现合格') if not complete else ('已确认偏离参考' if ordered else '未检测到超容差偏差')})
        return deepcopy(self.frozen)
    def cancel(self):self.state='cancelled';return {'state':self.state,'final_score':None}
