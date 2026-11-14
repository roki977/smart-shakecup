"""Read-only KB interface; stdlib; no scoring or invented causal diagnosis."""
from pathlib import Path
import argparse, json

class KnowledgeBase:
    def __init__(self, path=None):
        self.data=json.loads(Path(path or Path(__file__).with_name('知识库.json')).read_text(encoding='utf-8'))
        self.recipes={r['id']:r for r in self.data['recipes']}
        self.components={c['id']:c for c in self.data['components']}
        self.sources={s['id']:s for s in self.data['sources']}
    def recipe(self, recipe_id):
        if recipe_id not in self.recipes: raise ValueError(f'未知配方版本：{recipe_id}')
        r=self.recipes[recipe_id]
        return {**r,'source':self.sources[r['source_id']]}
    def search(self, query='', action=None):
        return [{'id':r['id'],'name':r['name'],'source_url':self.sources[r['source_id']]['url'],'open_issues':r['open_issues']} for r in self.recipes.values() if query.casefold() in (r['id']+' '+r['name']).casefold() and (action is None or any(s['action']==action for s in r['steps']))]
    def find_components(self, action, phase=None, **context):
        # Missing context is not treated as a wildcard truth. Results are candidates, not confirmation.
        return [c for c in self.components.values() if c['action']==action and (phase is None or c['phase']==phase) and all(c['context'].get(k,'unknown')==v for k,v in context.items())]
    def compare_observed_order(self, recipe_id, events):
        """events=[{step_id, evidence: user_confirmed|manual_verified|inferred|unknown}].
        Events are already ordered in time. Caller must supply recipe-instance step IDs,
        not bare action names; repeating shake/add_ice cannot be disambiguated otherwise.
        Only flags ordering of confirmed events. It cannot infer missing actions or causes.
        """
        r=self.recipe(recipe_id);positions={s['step_id']:i for i,s in enumerate(r['steps'])}
        allowed={'user_confirmed','manual_verified','inferred','unknown'}
        confirmed=[];ignored=[]
        for e in events:
            if e.get('step_id') not in positions:raise ValueError('事件不属于该配方版本；请使用其 step_id')
            if e.get('evidence') not in allowed:raise ValueError('必须明确事件证据类型')
            (confirmed if e['evidence'] in {'user_confirmed','manual_verified'} else ignored).append(e)
        if len({e['step_id'] for e in confirmed})!=len(confirmed):raise ValueError('重复 step_id；重复操作须映射到不同流程实例，不能覆盖')
        base={'recipe_id':recipe_id,'source_url':r['source']['url'],'ignored_unconfirmed_events':ignored,'can_assert_cause':False,'can_score':False}
        if r['open_issues']:return {**base,'status':'source_review_required','issues':r['open_issues'],'findings':[]}
        if len(confirmed)<2:return {**base,'status':'insufficient_evidence','findings':[]}
        findings=[]
        for i,e in enumerate(confirmed):
            for later in confirmed[i+1:]:
                if positions[e['step_id']]>positions[later['step_id']]:
                    findings.append({'type':'observed_order_differs_from_source_path','earlier_observed':e['step_id'],'later_observed':later['step_id'],'interpretation':'已确认事件与所选来源版本顺序不同；这不证明口感变差，也不代表其他版本错误。'})
        return {**base,'status':'observed_order_difference' if findings else 'no_observed_order_conflict','findings':findings,'unobserved_is_not_omitted':True}

def main():
    p=argparse.ArgumentParser(description='查询调酒知识库，不输出虚构风味分数。')
    sub=p.add_subparsers(dest='cmd',required=True)
    s=sub.add_parser('search');s.add_argument('query',nargs='?',default='');s.add_argument('--action')
    s=sub.add_parser('recipe');s.add_argument('id')
    s=sub.add_parser('component');s.add_argument('action');s.add_argument('--phase');s.add_argument('--ice')
    s=sub.add_parser('order');s.add_argument('id');s.add_argument('events_file')
    sub.add_parser('coverage');a=p.parse_args();kb=KnowledgeBase()
    if a.cmd=='search':out=kb.search(a.query,a.action)
    elif a.cmd=='recipe':out=kb.recipe(a.id)
    elif a.cmd=='component':out=kb.find_components(a.action,a.phase,**({'ice':a.ice} if a.ice else {}))
    elif a.cmd=='order':out=kb.compare_observed_order(a.id,json.loads(Path(a.events_file).read_text()))
    else:out=kb.data['coverage']
    print(json.dumps(out,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
