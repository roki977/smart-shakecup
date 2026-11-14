"""Version-bound measured reference storage. No synthetic reference creation."""
from pathlib import Path
import json, hashlib, math, copy
ROOT=Path(__file__).resolve().parent

def recipe_version(recipe):
    payload={k:recipe[k] for k in ('id','ingredients','steps','conditional_branches')}
    return hashlib.sha256(json.dumps(payload,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def validate(record, kb):
    recipes={r['id']:r for r in kb['recipes']}
    if record.get('recipe_id') not in recipes:raise ValueError('未知配方')
    if record.get('recipe_version')!=recipe_version(recipes[record['recipe_id']]):raise ValueError('配方版本不匹配')
    for key in ('id','session_id','bartender_id','captured_at','feature_version'):
        if not isinstance(record.get(key),str) or not record[key].strip():raise ValueError('缺少 '+key)
    if record.get('origin')!='measured':raise ValueError('标准曲线仅接受标为实测的数据')
    if record.get('status') not in ('pending_review','approved','rejected'):raise ValueError('审核状态无效')
    if not isinstance(record.get('conditions'),dict) or not record['conditions']:raise ValueError('缺少制作条件')
    if record['status']=='approved':
        if not all(record.get('review',{}).get(k) for k in ('reviewer_id','reviewed_at','basis')):raise ValueError('缺少审核依据')
    expected={'T':'degC','f':'Hz','A':'m/s2'}
    curves=record.get('curves',{})
    if set(curves)!=set(expected):raise ValueError('需要 T/f/A 三个通道；未得到的通道应为 null')
    valid_channels=0
    for name,unit in expected.items():
        curve=curves[name]
        if curve is None:continue
        if curve.get('unit')!=unit or curve.get('time_unit')!='s':raise ValueError('单位错误')
        points=curve.get('points',[])
        if not points:raise ValueError('没有数据点时用 null，不能传空的有效曲线')
        prev=-1
        for p in points:
            t=p.get('t');v=p.get('value');valid=p.get('valid')
            if isinstance(t,bool) or not isinstance(t,(int,float)) or not math.isfinite(t) or t<0 or t<=prev:raise ValueError('时间须有限、非负且严格递增')
            if not isinstance(valid,bool):raise ValueError('缺少有效性标记')
            if valid and (isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v)):raise ValueError('有效点须有有限数值')
            if not valid and v is not None:raise ValueError('无效点 value 应为 null')
            if valid and name in ('f','A') and v<0:raise ValueError('f/A 不得为负')
            prev=t
        if any(p['valid'] for p in points):valid_channels+=1
    if not valid_channels:raise ValueError('不能把空模板作为实测记录保存')
    return record

class ReferenceStore:
    def __init__(self, root=ROOT):self.root=Path(root)
    def list(self, recipe_id=None, approved_only=False):
        p=self.root/'标准曲线记录.json'
        records=json.loads(p.read_text())['records'] if p.exists() else []
        return [r for r in records if (recipe_id is None or r['recipe_id']==recipe_id) and (not approved_only or r['status']=='approved')]
    def save(self, record):
        kb=json.loads((self.root/'知识库.json').read_text());validate(record,kb)
        records=self.list()
        if any(r['id']==record['id'] for r in records):raise ValueError('记录ID已存在；禁止覆盖历史曲线')
        records.append(copy.deepcopy(record));p=self.root/'标准曲线记录.json';tmp=p.with_suffix('.tmp')
        tmp.write_text(json.dumps({'schema_version':'1.0','records':records},ensure_ascii=False,indent=2),encoding='utf-8');tmp.replace(p)
        return record['id']

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--import-file');p.add_argument('--recipe');args=p.parse_args();store=ReferenceStore()
    if args.import_file:print(store.save(json.loads(Path(args.import_file).read_text())))
    else:print(json.dumps(store.list(args.recipe),ensure_ascii=False,indent=2))
