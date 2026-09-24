// What is the dark shape in the sky? Hide candidates, re-measure.
import puppeteer from 'puppeteer-core'
const CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const b = await puppeteer.launch({executablePath:CHROME,headless:'new',
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--hide-scrollbars']})
const page = await b.newPage()
await page.setViewport({width:1691,height:1278,deviceScaleFactor:1})
await page.goto('http://localhost:3111/dev/world',{waitUntil:'domcontentloaded',timeout:60000})
await page.waitForFunction(()=>window.__worldReady===true,{timeout:180000,polling:250})
console.log('objects in the scene:', (await page.evaluate(()=>window.__worldNames?.() ?? [])).join(', '))

const park = async (d) => { await page.evaluate((dd)=>{const m=document.body.scrollHeight-window.innerHeight; window.scrollTo(0,dd*m)},d); await new Promise(r=>setTimeout(r,1800)) }
// Measure the SCREENSHOT, never the canvas. Reading back a WebGL canvas after
// the frame is presented returns black unless preserveDrawingBuffer is on —
// which it is not, and should not be. This cost a cycle earlier too.
const measure = async () => {
  const b64 = await page.screenshot({ encoding: 'base64' })
  return page.evaluate(async (src) => {
    const img = await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=src})
    const cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height
    const g=cv.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0)
    const h=Math.floor(cv.height*0.26)
    const d=g.getImageData(0,0,cv.width,h).data
    let dark=0,n=0
    for(let i=0;i<d.length;i+=4){const v=(d[i]+d[i+1]+d[i+2])/3;n++;if(v<40)dark++}
    return +(100*dark/n).toFixed(3)
  }, 'data:image/png;base64,' + b64)
}
await park(0.0708)
console.log(`\nsky band, top 26% of frame — % of pixels darker than 40:`)
console.log(`  everything            ${await measure()}%`)
for (const prefix of ['Ridge','Terrain','LM_','Path','Sea','Pine','Normal','Birch','Dead','Rock']) {
  const n = await page.evaluate((p)=>window.__worldHide?.(p) ?? 0, prefix)
  const v = await measure()
  console.log(`  after hiding ${prefix.padEnd(10)} ${String(v).padStart(7)}%   (${n} objects)`)
}
await b.close()
