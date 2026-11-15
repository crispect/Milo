import base64, io, shutil
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

source=Path('index.html').read_text()
three=Path('node_modules/three/build/three.module.js').read_text()
i=source.rfind('}catch(error){')
assert i>0
source=source[:i]+"""
window.inspectRoom=(x,z,d,a=0)=>{
 setViewIndicator("free");
 focus.set(x,.20,z);cameraGoal.focus.copy(focus);
 radius=cameraGoal.radius=d;
 azimuth=cameraGoal.azimuth=a;
 elevation=cameraGoal.elevation=1.20;
};
window.sceneDrawn=()=>renderer.info.render.calls>0&&!renderer.getContext().isContextLost();
"""+source[i:]
with sync_playwright() as api:
 browser=api.chromium.launch(executable_path=shutil.which('google-chrome'),args=['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader'])
 page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=2,has_touch=True,is_mobile=True)
 errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
 page.add_init_script("Date.prototype.getHours=()=>10")
 url='https://milo-preview.test/'
 page.route(url,lambda route:route.fulfill(body=source,content_type='text/html'))
 page.route('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js',lambda route:route.fulfill(body=three,content_type='application/javascript',headers={'access-control-allow-origin':'*'}))
 page.goto(url)
 page.locator('#load').wait_for(state='hidden',timeout=30000)
 page.wait_for_function('sceneDrawn()')
 sheet=Image.new('RGB',(900,580))
 for n,(label,x,z,d,a) in enumerate([
  ('jardin interior',-8.9,.18,19,3.02),('biblioteca',-8.9,-7.5,19,.05),('dormitorio',3,-6.33,21,.02),
  ('sala y cocina',-.25,0,30,.04),('estudio',8.8,-7.2,19,.18),('comedor',9.02,-.26,19,.10)]):
  page.evaluate('v=>inspectRoom(...v)',[x,z,d,a])
  page.wait_for_timeout(650)
  assert page.evaluate('sceneDrawn()'),label
  frame=Image.open(io.BytesIO(page.screenshot(scale='css'))).crop((8,210,382,570))
  frame.thumbnail((300,290))
  sheet.paste(frame,(300*(n%3),290*(n//3)))
 assert not errors,errors
 out=io.BytesIO()
 sheet.save(out,'JPEG',quality=67)
 print('ROOMS_JPEG '+base64.b64encode(out.getvalue()).decode())
 print('MILO_DECOR_WEBGL_PASS',flush=True)
 browser.close()
