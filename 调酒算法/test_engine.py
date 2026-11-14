import unittest,math,copy
import numpy as np
from engine import Engine,features,FeatureConfig,ahp,score,calibrate_tolerance

def config():
 return {'scoring_policy':'legacy-v1','version':'synthetic-v1','parameter_status':'synthetic_not_calibrated','recipe_version':'test-recipe-v1','feature_version':'hp-rms-acf-v1','r1':2,'r2':1,'anchor_loss':1,'anchor_score':80,'error_window_s':.2,'max_frame_gap_s':.21,'reference_max_gap_s':1,'window_min_coverage':1,'final_min_coverage':1,'on_s':.4,'off_s':.4,'recovery_ratio':.8,'merge_gap_s':.2,'feedback_limit':5,'stages':[{'id':'shake','evaluate_from_s':0,'end_s':2,'beta':1,'channels':['T','f','A'],'tolerance':{'T':.5,'f':.2,'A':.4},'scale':{'T':1,'f':.2,'A':.4}}]}
def reference():
 return {'id':'synthetic-reference','feature_version':'hp-rms-acf-v1','recipe_version':'test-recipe-v1','stages':{'shake':{j:[{'t':round(t,2),'value':v,'valid':True} for t in np.arange(0,4.01,.2)] for j,v in [('T',0),('f',3),('A',2)]}}}
def frame(t,T=0,f=3,A=2):return dict(t=round(t,6),T=T,f=f,A=A,feature_version='hp-rms-acf-v1')
def simulate(fn,until=2,cfg=None):
 e=Engine(cfg or config(),reference());e.start(0)
 for t in np.arange(.2,until+.01,.2):e.push(fn(round(t,6)))
 return e

def feature_cfg(fs=100):return FeatureConfig('hp-rms-acf-v1',2,.1,fs,.031,.2,.1,1,8,.05,.65,.3,.15)
def signal(fs=100,f=3,B=2,phase=0):
 return [{'t':i/fs,'ax':B*math.sin(2*math.pi*f*i/fs+phase),'ay':0,'az':9.81} for i in range(4*fs+1)]
class Algorithm(unittest.TestCase):
 def test_ahp(self):
  w=ahp(2,1);self.assertAlmostEqual(sum(w.values()),1);self.assertAlmostEqual(w['f'],1/6)
 def test_anchor(self):self.assertAlmostEqual(score(1,1,80),80)
 def test_example_743(self):
  e=simulate(lambda t:frame(t,T=1.5,f=3.6,A=2.3));r=e.finish(2)
  self.assertAlmostEqual(r['loss'],4/3);self.assertAlmostEqual(r['final_score'],74.26542134)
 def test_tolerance_zero_loss(self):
  e=simulate(lambda t:frame(t,T=.4,f=3.1));self.assertEqual(e.finish(2)['final_score'],100)
 def test_phase_invariance(self):
  cfg=feature_cfg();a=features(signal(),[],cfg)[-1];b=features(signal(phase=math.pi),[],cfg)[-1]
  self.assertAlmostEqual(a['f'],b['f'],places=4);self.assertAlmostEqual(a['A'],b['A'],places=4);self.assertAlmostEqual(a['f'],3,delta=.03);self.assertAlmostEqual(a['A'],2/math.sqrt(2),delta=.04)
 def test_sampling_rates(self):
  a=features(signal(),[],feature_cfg())[-1];b=features(signal(200),[],feature_cfg(200))[-1]
  self.assertAlmostEqual(a['f'],b['f'],delta=.03);self.assertAlmostEqual(a['A'],b['A'],delta=.04)
 def test_changed_frequency(self):self.assertAlmostEqual(features(signal(f=4),[],feature_cfg())[-1]['f'],4,delta=.04)
 def test_amplitude_doubles(self):
  a=features(signal(),[],feature_cfg())[-1];b=features(signal(B=4),[],feature_cfg())[-1];self.assertAlmostEqual(b['A']/a['A'],2)
 def test_rotation(self):
  a=signal();b=copy.deepcopy(a)
  for row in b:row['ay']=row['ax'];row['ax']=0
  self.assertAlmostEqual(features(a,[],feature_cfg())[-1]['A'],features(b,[],feature_cfg())[-1]['A'])
 def test_stop_not_missing(self):
  a=features(signal(B=0),[],feature_cfg())[-1];self.assertEqual(a['f'],0);self.assertEqual(a['motion'],'low_motion')
 def test_gap(self):
  a=signal();a=[r for r in a if not 3<r['t']<3.3];out=features(a,[],feature_cfg())[-1];self.assertIsNone(out['f']);self.assertEqual(out['motion'],'data_gap')
 def test_aperiodic(self):
  a=signal();rng=np.random.default_rng(42)
  for row in a:row['ax']=float(rng.normal())
  out=features(a,[],feature_cfg())[-1];self.assertIsNone(out['f']);self.assertIsNotNone(out['A'])
 def test_warmup(self):self.assertIsNone(features(signal(),[],feature_cfg())[0]['f'])
 def test_early_finish(self):self.assertIsNone(simulate(lambda t:frame(t),until=1).finish(1)['final_score'])
 def test_missing_no_full_score(self):self.assertIsNone(simulate(lambda t:frame(t,f=None)).finish(2)['final_score'])
 def test_current_recovers_final_retains(self):
  e=simulate(lambda t:frame(t,T=2 if t<=1 else 0));self.assertEqual(e.rows[-1]['current_score'],100);self.assertLess(e.finish(2)['final_score'],100)
 def test_extension_no_dilution(self):
  a=simulate(lambda t:frame(t,T=2 if t<=1 else 0));b=simulate(lambda t:frame(t,T=2 if t<=1 else 0),until=3)
  self.assertAlmostEqual(a.finish(2)['loss'],b.finish(3)['loss'])
 def test_persistent_one_event(self):
  r=simulate(lambda t:frame(t,T=2)).finish(2);self.assertEqual(len(r['events']),1);self.assertEqual(r['events'][0]['directions'],['high'])
 def test_no_topk_padding(self):self.assertEqual(simulate(lambda t:frame(t)).finish(2)['feedback_events'],[])
 def test_freeze(self):
  e=simulate(lambda t:frame(t));r=e.finish(2);self.assertFalse(e.push(frame(3,T=99))['accepted']);self.assertEqual(r,e.finish(4))
 def test_pause_does_not_shift_time(self):
  e=simulate(lambda t:frame(t),until=1);e.pause(1);e.resume(2);e.push(frame(2.2));self.assertIsNone(e.finish(2.2)['final_score'])
 def test_calibration(self):self.assertEqual(calibrate_tolerance([[1,2],[3,4]],.5,.5),[2,3])
 def test_version(self):
  r=reference();r['recipe_version']='wrong'
  with self.assertRaises(ValueError):Engine(config(),r)
 def test_stage_transition(self):
  c=config();a=copy.deepcopy(c['stages'][0]);c['stages'][0]['beta']=.5;a.update(id='shake2',beta=.5);c['stages'].append(a);r=reference();r['stages']['shake2']=copy.deepcopy(r['stages']['shake']);e=Engine(c,r);e.start(0)
  for t in np.arange(.2,2.01,.2):e.push(frame(t))
  e.transition(2,'confirmed')
  for t in np.arange(2.2,4.01,.2):e.push(frame(t))
  self.assertEqual(e.finish(4)['final_score'],100)
if __name__=='__main__':unittest.main()
