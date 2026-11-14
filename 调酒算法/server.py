"""Local integration server; serves website and /api from one origin. Not public hosting."""
from http.server import HTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
import argparse,json,uuid
from bridge import Session
SESSIONS={}
class Handler(SimpleHTTPRequestHandler):
    def reply(self,code,value):
        b=json.dumps(value,ensure_ascii=False,allow_nan=False).encode();self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_GET(self):
        parts=self.path.split('/')
        if self.path=='/api/health':return self.reply(200,{'status':'ok'})
        if len(parts)==5 and parts[1:3]==['api','sessions'] and parts[4]=='snapshot':
            s=SESSIONS.get(parts[3]);return self.reply(200,s.snapshot()) if s else self.reply(404,{'error':'unknown session'})
        return super().do_GET()
    def do_POST(self):
        try:
            data=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))));parts=self.path.split('/')
            if self.path=='/api/sessions':
                s=Session(data);sid=uuid.uuid4().hex;SESSIONS[sid]=s;return self.reply(201,{'id':sid})
            if len(parts)!=5 or parts[1:3]!=['api','sessions'] or parts[3] not in SESSIONS:return self.reply(404,{'error':'unknown route/session'})
            s=SESSIONS[parts[3]]
            if parts[4]=='data':out=s.ingest(data)
            elif parts[4]=='finish':out=s.finish(data['intent'])
            elif parts[4]=='event':
                action=data['action'];t=data['t']
                if action=='transition':s.e.transition(t,data['evidence'])
                elif action=='pause':s.e.pause(t)
                elif action=='resume':s.e.resume(t)
                elif action=='cancel':s.e.cancel()
                else:raise ValueError('unknown action')
                out=s.snapshot()
            else:return self.reply(404,{'error':'unknown route'})
            self.reply(200,out)
        except (ValueError,KeyError,TypeError,IndexError) as e:self.reply(400,{'error':str(e)})
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=8766);p.add_argument('--host',default='127.0.0.1');p.add_argument('--web-root',default=str(Path(__file__).resolve().parent.parent));a=p.parse_args()  # 默认网站目录：仓库根目录
    from functools import partial
    print(f'http://{a.host}:{a.port}',flush=True);HTTPServer((a.host,a.port),partial(Handler,directory=a.web_root)).serve_forever()
