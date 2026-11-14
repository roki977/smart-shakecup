"""Timestamp-based piecewise linear curves; no input sampling-rate requirement.
The original observations are retained. Drawing connects knots, not fitted polynomials.
"""
from bisect import bisect_left
from copy import deepcopy
import math
from statistics import median


def sampling_info(times):
    """Observed timestamp cadence, not a claim about an unobserved device clock."""
    if len(times)<2:return {'average_hz':None,'typical_hz':None,'interval_min_s':None,'interval_max_s':None,'regular':None}
    gaps=[b-a for a,b in zip(times,times[1:])]
    typical=median(gaps)
    return {'average_hz':(len(times)-1)/(times[-1]-times[0]),
            'typical_hz':1/typical,'interval_min_s':min(gaps),'interval_max_s':max(gaps),
            'regular':all(math.isclose(g,typical,rel_tol=1e-6,abs_tol=1e-9) for g in gaps)}


def curve(points, value_key='value', max_gap_s=None):
    """Return sorted knots and drawable segments. Times are seconds.
    Invalid observations break segments; optional max_gap_s also breaks long gaps.
    Without a declared gap limit, no missing sample is inferred from spacing alone.
    """
    if max_gap_s is not None and max_gap_s<=0:raise ValueError('max_gap_s must be positive')
    rows=sorted(deepcopy(points),key=lambda r:r['t'])
    knots=[];segments=[];active=[];last=None
    for r in rows:
        t=float(r['t']);v=r.get(value_key)
        if not math.isfinite(t):raise ValueError('timestamp must be finite')
        if last is not None and t==last:raise ValueError('duplicate timestamp')
        valid=r.get('valid',True) and v is not None and math.isfinite(v)
        point={'t':t,'value':float(v) if valid else None,'valid':bool(valid)}
        if not valid or (last is not None and max_gap_s is not None and t-last>max_gap_s):
            if active:segments.append(active);active=[]
        knots.append(point)
        if valid:active.append(point)
        last=t
    if active:segments.append(active)
    return {'sampling':sampling_info([p['t'] for p in knots]),'interpolation':'linear','time_unit':'s','points':knots,'segments':segments,'max_gap_s':max_gap_s}


def evaluate(line,times):
    """Interpolate inside an observed segment only; never extrapolate."""
    points=line['points'];ts=[p['t'] for p in points];output=[]
    for t in times:
        t=float(t);i=bisect_left(ts,t);v=None
        # Tolerate floating-point representations of the same timestamp.
        exact=next((k for k in (i,i-1) if 0<=k<len(ts) and math.isclose(ts[k],t,rel_tol=0,abs_tol=1e-9)),None)
        if exact is not None:v=points[exact]['value']
        elif 0<i<len(points):
            a,b=points[i-1],points[i];gap=b['t']-a['t']
            if a['valid'] and b['valid'] and (line['max_gap_s'] is None or gap<=line['max_gap_s']):
                v=a['value']+(b['value']-a['value'])*(t-a['t'])/gap
        output.append({'t':t,'value':v,'valid':v is not None})
    return output


def resample(line,step_s):
    """Optional output grid; step_s is not the sensor's Hz."""
    if not math.isfinite(step_s) or step_s<=0:raise ValueError('step_s must be positive')
    if not line['points']:return []
    a=line['points'][0]['t'];b=line['points'][-1]['t']
    grid=[a+i*step_s for i in range(int(math.floor((b-a)/step_s))+1)]
    if b-grid[-1]>1e-9:grid.append(b)
    return evaluate(line,grid)


def sensor_curves(imu,temperature,imu_gap_s=None,temperature_gap_s=None):
    return {'T':dict(curve(temperature,max_gap_s=temperature_gap_s),unit='°C'),
            **{k:dict(curve(imu,k,imu_gap_s),unit='m/s²') for k in ('ax','ay','az')}}
