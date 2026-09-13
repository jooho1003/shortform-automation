import json, os, re, shutil, unittest, uuid
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, build_opener

BASE=os.environ.get('DETAIL_PAGES_BASE_URL','http://localhost:3123').rstrip('/')
if urlparse(BASE).hostname not in ('localhost','127.0.0.1','::1'): raise RuntimeError('localhost only')
KEY=Path.home()/'AppData'/'Local'/'ShortformAutomation'/'detail-admin-key.txt'

class T(unittest.TestCase):
 def setUp(self):
  self.jar=CookieJar(); self.opener=build_opener(HTTPCookieProcessor(self.jar)); self.pid=None
  key=KEY.read_text(encoding='utf8').strip(); s,_=self.req('POST','/api/detail-admin',{'key':key},BASE); self.assertEqual(s,200)
  self.s,self.j=self.req('POST','/api/detail-pages',{'title':'API design temporary','client':'test','product':'test'},BASE); self.assertEqual(self.s,201); self.pid=self.j['id']
 def tearDown(self):
  if not self.pid: return
  root=Path(os.environ.get('SHORTFORM_ROOT',Path(__file__).resolve().parents[3])).resolve()/'상세페이지'; d=(root/self.pid).resolve()
  if d.parent==root and re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}',self.pid):
   f=d/'프로젝트.json'
   if f.is_file(): f.unlink()
   for x in d.iterdir(): x.unlink()
   d.rmdir()
 def req(self,m,p,b=None,origin=None):
  h={'Content-Type':'application/json'}
  if origin: h['Origin']=origin
  try:
   with self.opener.open(Request(BASE+p,data=json.dumps(b).encode() if b is not None else None,headers=h,method=m),timeout=60) as r: return r.status,json.loads(r.read())
  except HTTPError as e:
   try: return e.code,json.loads(e.read())
   except: return e.code,{}
 def login(self):
  key=KEY.read_text(encoding='utf8').strip(); s,_=self.req('POST','/api/detail-admin',{'key':key},BASE); self.assertEqual(s,200)
  c=next(c for c in self.jar if c.name=='detail_admin'); self.assertIn('HttpOnly',c._rest); self.assertEqual(c._rest.get('SameSite'),'strict')
 def design(self,rev=0,**kw):
  d={'revision':rev,'font':'sans','headingFont':'serif','colors':{'background':'#ffffff','text':'#111111','accent':'#ff0000','muted':'#888888'},'texts':{'hero-title':'hello'},'textStyles':{'hero-title':{'font':'sans','color':'#111111','size':24}},'images':{n:{'x':0,'y':0,'scale':1} for n in ('hero','texture','cgi','ritual','pack')}}; d.update(kw); return d
 def test_auth_and_design(self):
  self.req('DELETE','/api/detail-admin',None,BASE)
  anonymous=self.opener; self.opener=build_opener()
  try:
   self.opener.open(Request(BASE+f'/api/detail-pages/{self.pid}/design',headers={'Cookie':'detail_admin=invalid'}),timeout=60)
   self.fail('invalid cookie accepted')
  except HTTPError as error: self.assertEqual(error.code,401)
  self.opener=anonymous
  s,_=self.req('GET',f'/api/detail-pages/{self.pid}/design'); self.assertEqual(s,401)
  s,_=self.req('GET',f'/api/detail-pages/{self.pid}/design'); self.assertEqual(s,401)
  s,_=self.req('POST','/api/detail-pages',{'title':'x'},BASE); self.assertEqual(s,401)
  s,_=self.req('POST','/api/detail-admin',{'key':'bad'},BASE); self.assertEqual(s,401)
  self.login(); s,g=self.req('GET',f'/api/detail-pages/{self.pid}/design'); self.assertEqual((s,g['revision']),(200,0))
  s,g=self.req('PUT',f'/api/detail-pages/{self.pid}/design',self.design(),BASE); self.assertEqual((s,g['revision']),(200,1))
  s,g=self.req('GET',f'/api/detail-pages/{self.pid}/design'); self.assertEqual(g['revision'],1); self.assertEqual(g['textStyles'],self.design()['textStyles']); self.assertEqual(g['texts'],self.design()['texts']); self.assertEqual(g['images'],self.design()['images'])
  s,_=self.req('PUT',f'/api/detail-pages/{self.pid}/design',self.design(0),BASE); self.assertEqual(s,409)
  for bad in [self.design(1,colors={'background':'url(x)','text':'#111111','accent':'#ff0000','muted':'#888888'}),self.design(1,font='bad'),self.design(1,images={'hero':{'x':51,'y':0,'scale':1}}),self.design(1,texts={'__proto__':'x'}),self.design(1,textStyles={'hero-title':{'color':'bad'}}),self.design(1,textStyles={'hero-title':{'size':121}})]:
   s,_=self.req('PUT',f'/api/detail-pages/{self.pid}/design',bad,BASE); self.assertEqual(s,400)
  s,_=self.req('PUT',f'/api/detail-pages/{self.pid}/design',self.design(1,images={'hero':{'x':0,'y':0,'scale':0.5}}),BASE); self.assertEqual(s,400)
  s,_=self.req('PUT',f'/api/detail-pages/{self.pid}/design',self.design(1), 'https://evil.example'); self.assertEqual(s,403)
  s,_=self.req('DELETE','/api/detail-admin',None,BASE); self.assertEqual(s,200)
  s,_=self.req('PUT',f'/api/detail-pages/{self.pid}/design',self.design(1),BASE); self.assertEqual(s,401)

if __name__=='__main__': unittest.main(verbosity=2)
