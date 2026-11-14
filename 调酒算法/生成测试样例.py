"""Generate synthetic development inputs, NOT bartender data or validated parameters."""
import json
from dataclasses import asdict
from pathlib import Path
from test_engine import config,reference,frame,signal,feature_cfg
from engine import features
P=Path(__file__).resolve().parent
case={'description':'合成算例：RMSE T=1.5,f=0.6,A=0.3；预期最终约74.2654，不是实测','config':config(),'reference':reference(),'frames':[frame(i/5,T=1.5,f=3.6,A=2.3) for i in range(1,11)],'start_t':0,'finish_t':2,'commands':[]}
(P/'测试输入.json').write_text(json.dumps(case,ensure_ascii=False,indent=2))
imu=signal();temp=[{'t':i/15,'value':10.,'valid':True} for i in range(61)];fc=feature_cfg();ff=features(imu,temp,fc);c=config();c['stages'][0].update(evaluate_from_s=2,end_s=4)
r=reference();r['stages']['shake']={j:[{'t':x['t'],'value':x[j],'valid':x[j] is not None} for x in ff] for j in ('T','f','A')}
case={'description':'同一合成原始信号贯通接入、特征、评分；只用于代码一致性，不是独立物理验证','config':c,'reference':r,'imu':imu,'temperature':temp,'feature_config':asdict(fc),'start_t':0,'finish_t':4,'commands':[]}
(P/'原始数据测试输入.json').write_text(json.dumps(case,ensure_ascii=False,indent=2))
