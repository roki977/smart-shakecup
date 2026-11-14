import unittest
from test_engine import config,simulate,frame

class ScoringV2(unittest.TestCase):
 def run_case(self,ratio,duration=2,missing=False):
  c=config();c['scoring_policy']='tolerance-excess-v2'
  return simulate(lambda t:frame(t,T=.5*ratio if t<=duration else 0,f=None if missing else 3+.2*ratio if t<=duration else 3,A=2+.4*ratio if t<=duration else 2),cfg=c).finish(2)
 def test_independent_anchor(self):
  # All channels at twice tolerance => excess=1 => loss=1 => 50.
  self.assertAlmostEqual(self.run_case(2)['final_score'],50)
 def test_severity(self):
  scores=[self.run_case(r)['final_score'] for r in [1,1.5,2,3]]
  self.assertEqual(scores[0],100)
  self.assertTrue(all(a>b for a,b in zip(scores,scores[1:])))
  self.assertLess(scores[-1],10)
 def test_duration_and_recovery(self):
  short=self.run_case(3,.4)['final_score'];long=self.run_case(3,1.4)['final_score']
  self.assertLess(long,short);self.assertLess(short,100)
 def test_missing_keeps_evidence(self):
  r=self.run_case(3,missing=True)
  self.assertIsNone(r['final_score']);self.assertTrue(r['assessment']['confirmed_deviation'])
 def test_default_policy(self):
  c=config();del c['scoring_policy']
  with self.assertRaises(KeyError):simulate(lambda t:frame(t),cfg=c)

if __name__=='__main__':unittest.main()
