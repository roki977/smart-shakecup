import copy,unittest
from curves import curve,evaluate,resample,sensor_curves
class Curves(unittest.TestCase):
 def test_any_sampling_rate(self):
  for hz in (1,7.5,15,37,100,200):
   points=[{'t':i/hz,'value':2*(i/hz)+3} for i in range(int(hz*2)+1)]
   line=curve(points)
   for r in resample(line,.013):self.assertAlmostEqual(r['value'],2*r['t']+3)
 def test_irregular_and_changing_rate(self):
  p=[{'t':t,'value':3*t} for t in (0,.01,.03,.04,.11,.3,.7,1.2)]
  for r in evaluate(curve(p),(.02,.1,.5,1)) :self.assertAlmostEqual(r['value'],3*r['t'])
 def test_no_mutation(self):
  p=[{'t':1,'value':3},{'t':0,'value':2}];before=copy.deepcopy(p)
  curve(p);self.assertEqual(p,before)
 def test_observed_values_preserved(self):
  p=[{'t':0,'value':2},{'t':.31,'value':-5},{'t':1.2,'value':12}]
  self.assertEqual([r['value'] for r in evaluate(curve(p),[r['t'] for r in p])],[2,-5,12])
 def test_breaks(self):
  c=curve([{'t':0,'value':0},{'t':1,'value':None},{'t':2,'value':2}])
  self.assertEqual(len(c['segments']),2)
  self.assertIsNone(evaluate(c,[.5])[0]['value'])
  c=curve([{'t':0,'value':0},{'t':2,'value':2}],max_gap_s=.5)
  self.assertIsNone(evaluate(c,[1])[0]['value'])
 def test_no_extrapolation(self):
  c=curve([{'t':0,'value':0},{'t':1,'value':1}])
  self.assertTrue(all(r['value'] is None for r in evaluate(c,[-1,2])))
 def test_independent_clocks(self):
  c=sensor_curves([{'t':0,'ax':1,'ay':2,'az':3},{'t':.01,'ax':2,'ay':3,'az':4}],[{'t':0,'value':20},{'t':.07,'value':19}])
  self.assertEqual(c['T']['points'][-1]['t'],.07)
  self.assertEqual(c['ax']['points'][-1]['t'],.01)
 def test_empty_single_endpoint(self):
  self.assertEqual(resample(curve([]),.1),[])
  self.assertEqual(resample(curve([{'t':.3,'value':7}]),.1)[0]['value'],7)
  self.assertEqual(evaluate(curve([{'t':0,'value':0},{'t':.3,'value':7}]),[.1+.2])[0]['value'],7)

 def test_timestamp_hz(self):
  for hz in (7.5,15,100,200):
   c=curve([{'t':i/hz,'value':i} for i in range(31)])
   self.assertAlmostEqual(c['sampling']['average_hz'],hz)
   self.assertAlmostEqual(c['sampling']['typical_hz'],hz)
   self.assertTrue(c['sampling']['regular'])
 def test_irregular_hz(self):
  c=curve([{'t':t,'value':1} for t in (0,.1,.2,.4)])
  self.assertAlmostEqual(c['sampling']['average_hz'],7.5)
  self.assertAlmostEqual(c['sampling']['typical_hz'],10)
  self.assertFalse(c['sampling']['regular'])
