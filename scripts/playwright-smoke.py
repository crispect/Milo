import json
import math
import os
import shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

source = Path('index.html').read_text()
library = Path('node_modules/three/build/three.module.js').read_text()
end = source.rfind('}catch(error){')
assert end > 0
source = source[:end] + """
let qaFrames=0,qaAllocations=0;
const qaRender=renderer.render.bind(renderer),qaSetSize=renderer.setDrawingBufferSize.bind(renderer);
renderer.render=(...args)=>{qaRender(...args);qaFrames++};
renderer.setDrawingBufferSize=(...args)=>{qaAllocations++;qaSetSize(...args)};
const qaLoss=renderer.getContext().getExtension("WEBGL_lose_context");
window.miloCrashQA={
 read:()=>({
  frames:qaFrames, allocations:qaAllocations, focus:focus.toArray(), view:cameraView, radius,
  buffers:viewport, antialias:renderer.getContextAttributes()?.antialias,
  calls:renderer.info.render.calls, lost:webglLost, timeOrigin:performance.timeOrigin,
  progressSaved:!!localStorage.getItem(KEY), contextExtension:!!qaLoss,
 }),
 lose:()=>qaLoss.loseContext(), restore:()=>qaLoss.restoreContext()
};
""" + source[end:]
url = 'https://milo-preview.test/'
engine = os.environ['ENGINE']

with sync_playwright() as p:
    if engine == 'chromium':
        browser = p.chromium.launch(executable_path=shutil.which('google-chrome'), args=[
            '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'
        ])
    else:
        browser = p.webkit.launch()
    page = browser.new_page(viewport={'width':390,'height':844}, device_scale_factor=3,
                            is_mobile=True, has_touch=True, timezone_id='America/Santiago')
    errors = []
    page.on('pageerror', lambda err:errors.append(str(err)))
    page.on('console', lambda msg:errors.append(msg.text) if msg.type == 'error' else None)
    page.route(url, lambda route:route.fulfill(body=source, content_type='text/html'))
    page.route('https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js',
               lambda route:route.fulfill(body=library, content_type='application/javascript',
                                         headers={'access-control-allow-origin':'*'}))
    page.goto(url, wait_until='domcontentloaded')
    try:
        page.locator('#load').wait_for(state='hidden', timeout=29000)
    except Exception:
        print('MILO_START_FAILURE',page.locator('#load').inner_text(), errors, flush=True)
        raise

    def state():
        return page.evaluate('miloCrashQA.read()')

    loaded = state()
    print('MILO_LOADED',engine,json.dumps(loaded),flush=True)
    assert loaded['buffers'] == {'width':390,'height':844,'ratio':1.2}, loaded
    assert loaded['calls'] > 0 and loaded['antialias'] is False
    assert page.locator('canvas').evaluate("""
    (canvas) => ['touchstart','touchmove','gesturestart','gesturechange'].every(type =>
        !canvas.dispatchEvent(new Event(type,{cancelable:true,bubbles:true})))
    """)
    page.locator('#roomView').tap()
    page.wait_for_function("miloCrashQA.read().view==='den' && Math.abs(miloCrashQA.read().focus[2]+7.35)<.02")
    before = state()
    if engine == 'chromium':
        devtools = page.context.new_cdp_session(page)
        def touches(event, *points):
            devtools.send('Input.dispatchTouchEvent', {
                'type': event,
                'touchPoints': [{'x': x, 'y': y, 'id': i + 1} for i, (x, y) in enumerate(points)]
            })
        touches('touchStart',(115,221))
        for i in range(1,8):
            touches('touchMove',(115+16*i,221+17*i))
        touches('touchEnd')
        assert math.dist(state()['focus'],before['focus']) > .3
        touches('touchStart',(139,370),(251,370))
        radius = state()['radius']
        for i in range(1,6):
            touches('touchMove',(139-7*i,370),(251+7*i,370))
        touches('touchEnd')
        assert state()['radius'] < radius * .9
        input_method = 'browser-dispatched touch and pinch'
    else:
        page.locator('canvas').evaluate("""
        c => {
         const pointer = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type,{
           pointerId:id,clientX:x,clientY:y,pointerType:'touch',bubbles:true,cancelable:true
         }));
         pointer('pointerdown',1,115,221);
         pointer('pointermove',1,227,340);
         pointer('pointerup',1,227,340);
         pointer('pointerdown',1,139,370);pointer('pointerdown',2,251,370);
         pointer('pointermove',1,107,370);pointer('pointermove',2,283,370);
         pointer('pointerup',1,107,370);pointer('pointerup',2,283,370);
        }
        """)
        assert math.dist(state()['focus'],before['focus']) > .3
        assert state()['radius'] < before['radius'] * .9
        input_method = 'synthetic touch pointer events'
    assert state()['view'] == 'free'
    assert state()['timeOrigin'] == loaded['timeOrigin']
    allocations = state()['allocations']
    page.evaluate("for(let i=0;i<12;i++)window.dispatchEvent(new Event('resize'))")
    page.wait_for_timeout(350)
    assert state()['allocations'] == allocations
    page.set_viewport_size({'width':844,'height':390})
    page.wait_for_function("miloCrashQA.read().buffers.width===844 && miloCrashQA.read().buffers.height===390")
    assert state()['allocations'] == allocations + 1, state()
    assert state()['timeOrigin'] == loaded['timeOrigin']
    assert state()['view'] == 'free' and state()['buffers']['ratio'] == 1.2

    real_restore = False
    if state()['contextExtension']:
        page.evaluate('miloCrashQA.lose()')
        page.wait_for_function("miloCrashQA.read().lost === true")
        assert page.locator('#load').is_visible()
        assert state()['progressSaved']
        page.set_viewport_size({'width':390,'height':844})
        page.evaluate('miloCrashQA.restore()')
        page.locator('#load').wait_for(state='hidden', timeout=18000)
        assert state()['buffers'] == {'width':390,'height':844,'ratio':1}
        assert state()['view'] == 'free'
        real_restore = True

    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
    paused = state()['frames']
    page.wait_for_timeout(250)
    assert state()['frames'] == paused
    page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow'))")
    page.wait_for_function("frames=>miloCrashQA.read().frames>frames",arg=paused)
    assert state()['timeOrigin'] == loaded['timeOrigin']
    page.locator('#follow').tap()
    assert state()['view'] == 'milo'
    page.locator('#journal').tap()
    assert page.locator('#panel').evaluate("(panel)=>panel.classList.contains('open')")
    assert not errors, errors
    print('MILO_STABILITY_PASS',json.dumps({
      'engine':engine, 'input_method':input_method, 'rotated_viewport':True,
      'real_webgl_loss_and_restore':real_restore, 'pause_and_resume':True, 'errors':errors
    }),flush=True)
    browser.close()
