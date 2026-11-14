"""Temperature preprocessing; keep observations and validity provenance separate."""
import math
from statistics import median

def temperature_trace(samples,window_s=.25,tau_s=.15,gap_s=.5):
    if window_s<=0 or tau_s<=0 or gap_s<=0:raise ValueError('filter times must be positive')
    clean=[];rejected=[];history=[];filtered=[];previous=None;state=None
    for index,p in enumerate(samples):
        t=p['t'];v=p.get('temp',p.get('value'))
        if not p.get('valid',True) or v is None or not math.isfinite(v):
            rejected.append({'index':index,'reason':'invalid_observation'});continue
        if previous is not None and t<=previous:
            rejected.append({'index':index,'reason':'nonincreasing_timestamp'});continue
        clean.append({'t':t,'value':v,'valid':True,'source_index':index})
        if previous is None or t-previous>gap_s:history=[];state=None
        history.append((t,v));history=[x for x in history if t-x[0]<=window_s]
        center=median(x[1] for x in history)
        # Causal rolling median removes isolated impulses; EMA provides display smoothing.
        state=center if state is None else state+(1-math.exp(-(t-previous)/tau_s))*(center-state)
        filtered.append({'t':t,'value':state,'valid':True});previous=t
    return {'observed':clean,'smoothed':filtered,'rejected':rejected,
            'processing':{'version':'temperature-median-ema-v1','window_s':window_s,'tau_s':tau_s,'gap_s':gap_s,'causal':True,
             'purpose':'temperature_display_and_review','scoring_enabled':False}}
