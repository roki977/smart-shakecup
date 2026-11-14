import unittest,threading,json,urllib.request,tempfile
from pathlib import Path
from functools import partial
from http.server import HTTPServer
from bridge import PacketDecoder,Session
from server import Handler,SESSIONS
from test_engine import config,reference,frame
class Bridge(unittest.TestCase):
 def payload(self):return dict(algorithm=config(),reference=reference(),source='simulated')
 def test_units_time_probe(self):
  d=PacketDecoder(0,'g','last',1);a,t=d.decode({'ms':100,'acc_hz':100,'acc':[[1,0,0],[2,0,0]],'temp':[99,5]})
  self.assertAlmostEqual(a[0]['t'],.09);self.assertAlmostEqual(a[0]['ax'],9.80665);self.assertEqual(t[0]['value'],5)
 def test_partial_does_not_freeze_failed_complete(self):
  s=Session(self.payload());s.ingest({'frames':[frame(.2)]})
  with self.assertRaises(ValueError):s.finish('complete')
  self.assertEqual(s.e.state,'running');self.assertIsNone(s.finish('partial')['final']['value'])
 def test_http_and_export_ui(self):
  srv=HTTPServer(('127.0.0.1',0),Handler);th=threading.Thread(target=srv.serve_forever,daemon=True);th.start();base=f'http://127.0.0.1:{srv.server_port}'
  def call(path,data=None):
   req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req) as r:return json.load(r)
  try:
   sid=call('/api/sessions',self.payload())['id'];path='/api/sessions/'+sid
   call(path+'/data',{'frames':[frame(i/5,T=1.5,f=3.6,A=2.3) for i in range(1,11)]})
   snap=call(path+'/snapshot');result=call(path+'/finish',{'intent':'complete'})
   self.assertAlmostEqual(result['final']['value'],74.2654213378)
   self.assertEqual(result,call(path+'/finish',{'intent':'complete'}))
   Path('/tmp/cocktail-ui-contract.json').write_text(json.dumps({'frame':snap,'result':result}))
  finally:srv.shutdown();srv.server_close();th.join()
if __name__=='__main__':unittest.main()
