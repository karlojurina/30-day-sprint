import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT='shots/arrival'; fs.mkdirSync(OUT,{recursive:true})
const browser=await puppeteer.launch({executablePath:CHROME,headless:'new',args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars']})
for(const vp of [{n:'split',w:1691,h:1278},{n:'ultra',w:3428,h:1230}]){
  const page=await browser.newPage()
  await page.setViewport({width:vp.w,height:vp.h,deviceScaleFactor:1})
  await page.goto('http://localhost:3111/dev/world',{waitUntil:'domcontentloaded',timeout:120000})
  await page.waitForFunction(()=>window.__worldReady===true,{timeout:180000,polling:250})
  console.log(`\n### ${vp.n} ${vp.w}x${vp.h}`)
  for(const [name,d] of [['a1',0.0708],['a2',0.1934],['a7',0.6863],['a8',0.8302]]){
    await page.evaluate(dd=>window.scrollTo(0,window.__worldScrollFor(dd)),d)
    try{ await page.waitForFunction(dd=>Math.abs(window.__worldDepth-dd)<0.0015,{timeout:120000,polling:200},d) }catch{ }
    const i=await page.evaluate(()=>({d:window.__worldDepth,m:window.__worldMarkers,w:innerWidth,h:innerHeight}))
    const me=i.m.find(m=>m.id===name)
    console.log(`${name} depth=${i.d.toFixed(4)}  OWN MARKER: x%=${(me.x/i.w*100).toFixed(1)} y%=${(me.y/i.h*100).toFixed(1)} visible=${me.visible} prox=${me.proximity.toFixed(2)}`)
    console.log('    visible others:', i.m.filter(m=>m.visible&&m.id!==name).map(m=>`${m.id}@${(m.x/i.w*100).toFixed(0)}%`).join(' '))
    if(vp.n==='split') await page.screenshot({path:`${OUT}/${name}-split.png`})
  }
  if(vp.n==='split'){
    await page.evaluate(dd=>window.scrollTo(0,window.__worldScrollFor(dd)),0.1934)
    await page.waitForFunction(()=>Math.abs(window.__worldDepth-0.1934)<0.0015,{timeout:120000,polling:200})
    await page.screenshot({path:`${OUT}/blades-on.png`})
    await page.evaluate(()=>window.__worldHide('LM_WindmillB'))
    await new Promise(r=>setTimeout(r,3000))
    await page.screenshot({path:`${OUT}/blades-off.png`})
  }
  await page.close()
}
await browser.close()
