import unittest,math
from dataclasses import asdict
from test_engine import config,reference,Engine,frame,signal,feature_cfg
from engine import features,interpolate
class Recovery(unittest.TestCase):
 def test_endpoint(self):
  self.assertEqual(interpolate([{'t':0,'value':0},{'t':.3,'value':1}],.1+.2,1),1)
 def test_reverse_time(self):
  e=Engine(config(),reference());e.start(0);e.push(frame(.2));e.pause(.2)
  with self.assertRaises(ValueError):e.resume(.1)
 def test_gap_not_filled(self):
  c=asdict(feature_cfg());c['recovery_window_s']=1
  rows=[r for r in signal() if not 3<r['t']<3.3]
  self.assertIsNone(features(rows,[],c)[-1]['f'])
 def test_noise_not_filled(self):
  import numpy as np
  rows=signal();rng=np.random.default_rng(42)
  for r in rows:r['ax']=float(rng.normal())
  c=asdict(feature_cfg());c['recovery_window_s']=1
  self.assertIsNone(features(rows,[],c)[-1]['f'])
 def test_causal(self):
  c=asdict(feature_cfg());c['recovery_window_s']=1
  rows=signal();full=features(rows,[],c)
  partial=features(rows[:301],[],c)
  self.assertEqual(full[:len(partial)],partial)
 def test_reciprocal(self):
  c=config();c.update(scoring_policy='tolerance-excess-v2',score_mapping='reciprocal-v2')
  e=Engine(c,reference())
  self.assertEqual(e._score(0),100);self.assertEqual(e._score(1),50)
  self.assertEqual(e._score(4),20)
