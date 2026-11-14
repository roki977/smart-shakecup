import unittest,importlib.util,json,tempfile,copy
from pathlib import Path
P=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('refs',P/'标准曲线.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class References(unittest.TestCase):
 def setUp(self):
  self.k=json.loads((P/'知识库.json').read_text());r=self.k['recipes'][0]
  self.record={'id':'test-only','session_id':'test','bartender_id':'test','captured_at':'2026-11-14T00:00:00+08:00','feature_version':'test','recipe_id':r['id'],'recipe_version':r['recipe_version'],'origin':'measured','status':'pending_review','conditions':{'fixture':'unit-test-only'},'curves':{'T':{'unit':'degC','time_unit':'s','points':[{'t':0,'value':10,'valid':True}]},'f':None,'A':None}}
 def test_empty_export(self):self.assertEqual(json.loads((P/'标准曲线记录.json').read_text())['records'],[])
 def test_bindings(self):
  self.assertTrue(all(r['reference_binding']['status']=='awaiting_measurement' for r in self.k['recipes']))
 def test_version_mismatch(self):
  self.record['recipe_version']='wrong'
  with self.assertRaises(ValueError):m.validate(self.record,self.k)
 def test_no_placeholder_import(self):
  self.record['curves']['T']=None
  with self.assertRaises(ValueError):m.validate(self.record,self.k)
 def test_approval_needs_evidence(self):
  self.record['status']='approved'
  with self.assertRaises(ValueError):m.validate(self.record,self.k)
 def test_bad_time_and_units(self):
  self.record['curves']['T']['unit']='F'
  with self.assertRaises(ValueError):m.validate(self.record,self.k)
 def test_partial_store_and_no_overwrite(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td);(p/'知识库.json').write_text(json.dumps(self.k));st=m.ReferenceStore(p)
   st.save(self.record);self.assertEqual(len(st.list()),1);self.assertEqual(st.list(approved_only=True),[])
   with self.assertRaises(ValueError):st.save(self.record)
if __name__=='__main__':unittest.main()
