import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties
root=Path(__file__).resolve().parent;font=FontProperties(fname='/System/Library/Fonts/STHeiti Medium.ttc');d=json.loads((root/'白色佳人原始数据.json').read_text());fig,axes=plt.subplots(2,2,figsize=(14,8))
for i,run in enumerate(d['runs']):
 x=json.loads((root/('white-lady-'+run['id']+'-temperature-v1.json')).read_text());ax=axes[i,0]
 ax.plot([s['t'] for s in run['samples']],[s['temp'] for s in run['samples']],color='#aaaaaa',label='原网页记录（含无效点）')
 clean=x['display_trace_cleaning']['observed'];ax.plot([s['t'] for s in clean],[s['value'] for s in clean],color='#008577',label='剔除无效点')
 ax.set_title('第%d杯：网页时间折返修正'%(i+1),fontproperties=font)
 ax=axes[i,1]
 for key,label,col in [('mean_temperature','原始双探头平均','#bcbcbc'),('filtered_temperature','温度滤波','#008577')]:
  tx=[];ys=[];prev=None
  for s in x[key]:
   if prev is not None and s['t']-prev>.5:tx.append(float('nan'));ys.append(float('nan'))
   tx.append(s['t']);ys.append(s['value']);prev=s['t']
  ax.plot(tx,ys,label=label,color=col)
 ax.set_title('第%d杯：设备时间轴（缺测处断线）'%(i+1),fontproperties=font)
for ax in axes.flat:
 ax.set_xlabel('时间 / 秒',fontproperties=font);ax.set_ylabel('温度 / °C',fontproperties=font);ax.grid(alpha=.2);ax.legend(prop=font)
fig.tight_layout();fig.savefig(root/'白色佳人去噪对照.png',dpi=140)
