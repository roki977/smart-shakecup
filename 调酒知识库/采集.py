from pathlib import Path
import requests,json,re,time
from concurrent.futures import ThreadPoolExecutor
from html import unescape
def clean(s):return unescape(re.sub("<[^>]+>"," ",s)).strip()
from datetime import datetime
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parent
stamp=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat()
old=json.loads((ROOT/'IBA配方快照.json').read_text())
base='https://iba-world.com/cocktails/all-cocktails/'
def get(u):
 r=requests.get(u,timeout=30);r.raise_for_status();return r.text
pages=[];links=set()
for i in range(1,7):
 u=base if i==1 else base+f'page/{i}/'
 try:
  h=get(u); found=set(re.findall(r'https://iba-world.com/iba-cocktail/[^\"\'<> ]+',h))
  links.update(found);pages.append({'url':u,'count':len(found),'status':'ok'})
 except Exception as e:pages.append({'url':u,'status':'failed','error':str(e)})
 print('listing',i,len(links),flush=True)
def check(r):
 try:
  h=get(r['source_url']); fields={}
  heads=list(re.finditer(r'<h4\b[^>]*>(.*?)</h4>',h,re.S|re.I))
  for i,hd in enumerate(heads):
   key={'ingredients':'ingredients_text','method':'method_text','garnish':'garnish_text'}.get(clean(hd[1]).lower())
   if key:
    chunk=h[hd.end():heads[i+1].start() if i+1<len(heads) else len(h)]
    match=re.search(r'<div class="elementor-shortcode">(.*?)</div>',chunk,re.S)
    fields[key]=clean(match[1]) if match else ''
  return {'name':r['name'],'url':r['source_url'],'checked_at':stamp,'status':'ok' if fields.get('method_text') else 'needs_review','method_changed':re.sub(r'\s+',' ',fields.get('method_text','')).strip()!=re.sub(r'\s+',' ',r['method_text']).strip(),'fields':fields}
 except Exception as e:return {'name':r['name'],'url':r['source_url'],'status':'failed','error':str(e)}
with ThreadPoolExecutor(max_workers=4) as ex:checks=list(ex.map(check,old['recipes']))
report={'checked_at':stamp,'listing_pages':pages,'listing_urls':sorted(links),'previous_urls':[r['source_url'] for r in old['recipes']],'checks':checks}
(ROOT/'来源核验.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('DONE',len(checks),{s:sum(x['status']==s for x in checks) for s in ['ok','needs_review','failed']},flush=True)
