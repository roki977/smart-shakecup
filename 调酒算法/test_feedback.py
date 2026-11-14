import unittest
from feedback import explain,steps,knowledge
class Feedback(unittest.TestCase):
 def test_steps_preserve_order(self):
  r=knowledge()['recipes'][0];s=steps(r['id'],r['recipe_version'])
  self.assertEqual([x['step_id'] for x in s['steps']],[x['step_id'] for x in r['steps']])
  self.assertEqual(s['steps'][0]['context']['loading_order'],'unspecified')
 def test_merge_and_uncertainty(self):
  es=[dict(stage='s',variable='f',directions=['high'],start_s=i,end_s=i+1,contribution=1) for i in [1,3]]
  a=explain({'events':es});self.assertEqual(len(a['issues']),1);self.assertEqual(len(a['issues'][0]['intervals']),2)
  b=explain({'events':es},quality=[{'start':0,'end':5,'flags':{'f':'valid_short_window'}}]);self.assertEqual(b['issues'],[])
 def test_unmatched(self):self.assertEqual(steps('wrong','wrong')['steps'],[])
