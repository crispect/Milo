import base64
import json
import math
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path.cwd()
html = (root / 'index.html').read_text()
three = (root / 'node_modules/three/build/three.module.js').read_text()
replacement = html.rfind('}catch(error){')
assert replacement >= 0
html = html[:replacement] + """
window.cameraQA=() => ({
    view:cameraView, radius, azimuth, focus:focus.toArray(), goal:cameraGoal.focus.toArray(),
    dog:dog.position.toArray(), webgl:!!renderer.getContext(),
    pixelWidth:canvas.width, pixelHeight:canvas.height,
    drawCalls:renderer.info.render.calls,
    shadowDirty:sun.shadow.needsUpdate,
    roomToys:state.props.filter(toy=>toy.home==='milo').length,
    load:document.querySelector('#load').style.display
});
""" + html[replacement:]
target = 'https://milo-preview.test/'
output = Path('browser-screens')
output.mkdir(exist_ok=True)

with sync_playwright() as app:
    chrome = shutil.which('google-chrome') or shutil.which('chromium')
    browser = app.chromium.launch(executable_path=chrome, args=[
        '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'
    ])
    page = browser.new_page(viewport={'width':390,'height':844}, device_scale_factor=2,
                            is_mobile=True, has_touch=True, timezone_id='America/Santiago')
    page.add_init_script("Date.prototype.getHours=function(){return 20};")
    errors = []
    page.on('pageerror', lambda err:errors.append(str(err)))
    page.on('console', lambda msg:errors.append(msg.text) if msg.type == 'error' else None)
    page.route(target, lambda route:route.fulfill(body=html, content_type='text/html'))
    page.route('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js',
               lambda route:route.fulfill(body=three, content_type='application/javascript',
                                         headers={'access-control-allow-origin':'*'}))

    def state():
        return page.evaluate('window.cameraQA()')

    def shot(name):
        image = page.screenshot(path=output / f'{name}.jpg', type='jpeg', quality=68, scale='css')
        if name in ('recinto', 'inicio'):
            print('MILO_JPEG_' + name + ' ' + base64.b64encode(image).decode(), flush=True)

    def stopped_near(x, z):
        page.wait_for_function("([x,z])=>Math.hypot(cameraQA().focus[0]-x,cameraQA().focus[2]-z)<.02", arg=[x,z], timeout=15000)

    page.goto(target, wait_until='domcontentloaded')
    try:
        page.locator('#load').wait_for(state='hidden', timeout=29000)
    except Exception:
        print(json.dumps({'load':page.locator('#load').inner_text(), 'errors':errors}, ensure_ascii=False), flush=True)
        raise
    assert state()['webgl'] and state()['roomToys'] == 6
    assert state()['drawCalls'] > 0 and not state()['shadowDirty']
    print('MILO_WEBGL_STARTED',json.dumps(state()),flush=True)
    shot('inicio')

    page.locator('#roomView').tap()
    stopped_near(-2.95,-7.35)
    assert state()['view'] == 'den'
    assert page.locator('#roomView').get_attribute('aria-pressed') == 'true'
    page.wait_for_timeout(450)
    shot('recinto')
    page.locator('#houseView').tap()
    stopped_near(-.04,2.45)
    assert state()['view'] == 'house'
    shot('casa')
    page.locator('#roomView').tap()
    stopped_near(-2.95,-7.35)

    session = page.context.new_cdp_session(page)
    def touch(event, *points):
        session.send('Input.dispatchTouchEvent', {
            'type':event,
            'touchPoints':[{'x':x,'y':y,'id':i+1} for i,(x,y) in enumerate(points)]
        })

    before = state()
    touch('touchStart',(122,370))
    for i in range(1,7):
        touch('touchMove',(122+10*i,370+4*i))
    touch('touchEnd')
    page.wait_for_function("cameraQA().view==='free'")
    moved = state()
    assert math.dist(moved['focus'],before['focus']) > .3
    assert abs(moved['azimuth'] - before['azimuth']) < .001

    touch('touchStart',(145,358),(245,358))
    for i in range(1,6):
        touch('touchMove',(145-6*i,358),(245+6*i,358))
    touch('touchEnd')
    assert state()['radius'] < moved['radius'] * .9, (moved, state())

    before_angle = state()['azimuth']
    page.locator('#rotateView').tap()
    page.wait_for_function("a=>Math.abs(cameraQA().azimuth-(a-Math.PI/2))<.02", arg=before_angle, timeout=15000)
    page.locator('#follow').tap()
    page.wait_for_function("cameraQA().view==='milo'&&Math.hypot(cameraQA().focus[0]-cameraQA().dog[0],cameraQA().focus[2]-cameraQA().dog[2])<.15",timeout=15000)
    page.locator('#journal').tap()
    assert page.locator('#panel').evaluate("(p) => p.classList.contains('open')")
    assert not errors, errors
    print('MILO_BROWSER_PASS',json.dumps({'software_webgl':True,'mobile_viewport':[390,844],
        'worked':['loading','room shortcut','house shortcut','touch drag','pinch','rotate','follow','journal'],
        'errors':errors},ensure_ascii=False),flush=True)
    browser.close()
