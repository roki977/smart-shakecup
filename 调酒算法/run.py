"""python3 run.py case.json --output result.json. All examples are synthetic."""
import argparse,json
from engine import Engine,features
from curves import sensor_curves,curve

def run(case):
    frames=features(case['imu'],case['temperature'],case['feature_config']) if 'imu' in case else case['frames']
    engine=Engine(case['config'],case['reference']);engine.start(case.get('start_t',0))
    commands=case.get('commands',[])
    # At equal timestamps the frame belongs to the stage being ended; command applies afterwards.
    timeline=sorted([(f['t'],0,f) for f in frames if f['t']>case.get('start_t',0)]+[(c['t'],1,c) for c in commands],key=lambda x:(x[0],x[1]))
    for t,kind,item in timeline:
        if kind==0:engine.push(item)
        elif item['action']=='transition':engine.transition(t,item['evidence'])
        elif item['action']=='pause':engine.pause(t)
        elif item['action']=='resume':engine.resume(t)
        elif item['action']=='finish':engine.finish(t)
        elif item['action']=='cancel':engine.cancel()
        else:raise ValueError('unknown command')
    result=engine.frozen if engine.frozen else (engine.finish(case['finish_t']) if engine.state!='cancelled' else {'state':'cancelled','final_score':None})
    lines=sensor_curves(case['imu'],case.get('temperature',[])) if 'imu' in case else {j:curve(frames,j) for j in ('T','f','A')}
    return {'curves':lines,'effective_feature_config':case.get('feature_config'),'features':frames,'timeline':engine.rows,'result':result}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('case');p.add_argument('--output',required=True);a=p.parse_args()
    with open(a.case) as f:case=json.load(f)
    result=run(case)
    with open(a.output,'w') as f:json.dump(result,f,ensure_ascii=False,indent=2,allow_nan=False)
    print(json.dumps(result['result'],ensure_ascii=False,indent=2))
