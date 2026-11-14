import unittest
from denoise import temperature_trace
class Denoise(unittest.TestCase):
 def test_invalid_time_reversal(self):
  r=temperature_trace([{'t':0,'temp':10},{'t':3,'temp':10,'valid':False},{'t':1,'temp':9}])
  self.assertEqual([p['t'] for p in r['observed']],[0,1]);self.assertEqual(len(r['rejected']),1)
 def test_impulse(self):
  s=[{'t':i*.05,'temp':50 if i==20 else 10} for i in range(50)]
  self.assertEqual(max(p['value'] for p in temperature_trace(s)['smoothed']),10)
 def test_real_change_preserved(self):
  s=[{'t':i*.05,'temp':10 if i<20 else 5} for i in range(70)]
  r=temperature_trace(s);self.assertAlmostEqual(r['smoothed'][-1]['value'],5,places=4)
 def test_causal_and_gap(self):
  s=[{'t':i*.05,'temp':10-i*.02} for i in range(50)]
  self.assertEqual(temperature_trace(s[:25])['smoothed'],temperature_trace(s)['smoothed'][:25])
  self.assertEqual(temperature_trace([{'t':0,'temp':20},{'t':5,'temp':5}])['smoothed'][-1]['value'],5)
