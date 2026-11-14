import unittest, importlib.util
from pathlib import Path
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('kb_query',P/'查询.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class KnowledgeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.k=mod.KnowledgeBase()
 def r(self,id):return self.k.recipe(id)
 def test_full_iba_and_no_fake_curves(self):
  self.assertEqual(len([r for r in self.k.recipes if r.startswith('iba-')]),102)
  self.assertTrue(all(r['reference_curves'] is None and not r['diagnosis_ready'] for r in self.k.recipes.values()))
 def test_graph_integrity(self):
  d=self.k.data
  paths=[r['steps'] for r in d['recipes']]+[p['steps'] for r in d['recipes'] for p in r['ingredient_preparations']]+[p['steps'] for p in d['technique_paths']]
  ids=set(self.k.recipes)|set(self.k.components)|{b['id'] for b in d['branch_nodes']}|{s['step_id'] for p in paths for s in p}
  for edge in d['edges']:self.assertIn(edge['from'],ids);self.assertIn(edge['to'],ids)
  for c in d['components']:
   for effect in c['effects']:
    for sid in effect['source_ids']:self.assertIn(sid,self.k.sources)
 def test_wet_and_reverse_dry_distinct(self):
  steps=[s for s in self.r('iba-ramos-fizz')['steps'] if s['action']=='shake']
  self.assertEqual([s['context']['ice'] for s in steps],['present','absent'])
  self.assertNotEqual(steps[0]['component_id'],steps[1]['component_id'])
  self.assertEqual([s['context']['duration_seconds'] for s in steps],[120,60])
 def test_ice_positions_are_distinct(self):
  steps=[s for s in self.r('iba-chartreuse-swizzle')['steps'] if s['action']=='add_ice']
  self.assertEqual(len(steps),2);self.assertNotEqual(steps[0]['component_id'],steps[1]['component_id'])
 def test_no_universal_twelve_seconds(self):
  s=[s for s in self.r('iba-grand-margarita')['steps'] if s['action']=='shake'][0]
  self.assertEqual(s['context']['duration_seconds'],10)
  s=[s for s in self.r('iba-grasshopper')['steps'] if s['action']=='shake'][0]
  self.assertNotIn('duration_seconds',s['context'])
 def test_long_island_is_not_shaken(self):
  self.assertNotIn('shake',[s['action'] for s in self.r('iba-long-island-iced-tea')['steps']])
 def test_sunrise_no_stir(self):
  a=[s['action'] for s in self.r('iba-tequila-sunrise')['steps']]
  self.assertIn('do_not_stir',a);self.assertNotIn('stir',a)
 def test_champagne_sidecar_not_topping(self):
  a=[s['action'] for s in self.r('iba-porn-star-martini')['steps']]
  self.assertIn('serve_sidecar',a);self.assertNotIn('top',a)
 def test_unknown_ice_stays_unknown(self):
  s=[s for s in self.r('iba-french-75')['steps'] if s['action']=='shake'][0]
  self.assertEqual(s['context']['ice'],'unknown')
 def test_difford_and_iba_do_not_merge(self):
  iba=[s for s in self.r('iba-whiskey-sour')['steps'] if s['action']=='shake']
  dif=[s for s in self.r('difford-whiskey-sour')['steps'] if s['action']=='shake']
  self.assertEqual(len(iba),1);self.assertEqual(len(dif),2)
 def test_unknown_event_not_error(self):
  r=self.r('iba-daiquiri');ev=[{'step_id':s['step_id'],'evidence':'inferred'} for s in r['steps'][::-1]]
  result=self.k.compare_observed_order(r['id'],ev)
  self.assertEqual(result['status'],'insufficient_evidence');self.assertEqual(result['findings'],[])
 def test_only_confirmed_inversion(self):
  r=self.r('iba-daiquiri');ev=[{'step_id':s['step_id'],'evidence':'user_confirmed'} for s in r['steps'][1:3][::-1]]
  result=self.k.compare_observed_order(r['id'],ev)
  self.assertEqual(result['status'],'observed_order_difference');self.assertFalse(result['can_score'])
 def test_source_ambiguity_blocks_auto_judgement(self):
  self.assertEqual(self.k.compare_observed_order('iba-new-york-sour',[])['status'],'source_review_required')
 def test_missing_is_not_omitted(self):
  r=self.r('iba-daiquiri');ev=[{'step_id':r['steps'][i]['step_id'],'evidence':'manual_verified'} for i in (0,3)]
  out=self.k.compare_observed_order(r['id'],ev);self.assertEqual(out['findings'],[]);self.assertTrue(out['unobserved_is_not_omitted'])
 def test_repeat_step_rejected(self):
  s=self.r('iba-daiquiri')['steps'][0]['step_id'];e={'step_id':s,'evidence':'user_confirmed'}
  with self.assertRaises(ValueError):self.k.compare_observed_order('iba-daiquiri',[e,e])
 def test_spoon_is_not_cup_imu(self):
  for c in self.k.find_components('stir'):self.assertEqual(c['observability']['status'],'not_observable_reliably')
if __name__=='__main__':unittest.main()
