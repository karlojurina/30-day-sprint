import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p = await b.newPage()
const files = {
  browser: '/Users/lovro/Documents/Main Engine/claude-code-workspace-generator-main/30-day-sprint/world-tests/shots/split-1691x1278-depth0_0708.png',
  blender: '/private/tmp/claude-501/-Users-lovro-Documents-Main-Engine-claude-code-workspace-generator-main/c595b665-2f5d-4300-a450-2a13fec55307/scratchpad/shots/blender-d0071.png',
}
const urls = Object.fromEntries(Object.entries(files).map(([k,v])=>[k,'data:image/png;base64,'+fs.readFileSync(v).toString('base64')]))
const out = await p.evaluate(async (u) => {
  const load = s => new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=s})
  const res = {}
  for (const [k,src] of Object.entries(u)) {
    const img = await load(src)
    const c = document.createElement('canvas'); c.width=img.width; c.height=img.height
    const g = c.getContext('2d'); g.drawImage(img,0,0)
    // scan the sky band for anything much darker than its neighbours
    const y0 = Math.floor(img.height*0.18), y1 = Math.floor(img.height*0.30)
    const d = g.getImageData(0,y0,img.width,y1-y0).data
    let darkest = 255, darkestX = -1, n=0, sum=0
    for (let i=0;i<d.length;i+=4){
      const v=(d[i]+d[i+1]+d[i+2])/3; sum+=v; n++
      if (v<darkest){darkest=v; darkestX=Math.floor((i/4)%img.width)}
    }
    res[k] = {size:[img.width,img.height], skyMean:+(sum/n).toFixed(1), darkest:+darkest.toFixed(1), darkestX}
  }
  return res
}, urls)
await b.close()
console.log('sky band (18%-30% of height):')
for (const [k,v] of Object.entries(out)) console.log(`  ${k.padEnd(8)} ${v.size.join('x').padEnd(10)} mean ${String(v.skyMean).padStart(6)}  darkest ${String(v.darkest).padStart(6)} at x=${v.darkestX}`)
