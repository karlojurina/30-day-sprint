import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')
const files = fs.readdirSync(OUT).filter(f => /^(split|ultrawide)-.*\.png$/.test(f)).sort()
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p = await b.newPage()
const urls = Object.fromEntries(files.map(f => [f,'data:image/png;base64,'+fs.readFileSync(path.join(OUT,f)).toString('base64')]))
const out = await p.evaluate(async (u) => {
  const load = s => new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=s})
  const res = {}
  for (const [k,src] of Object.entries(u)) {
    const img = await load(src)
    const c=document.createElement('canvas'); c.width=img.width; c.height=img.height
    const g=c.getContext('2d'); g.drawImage(img,0,0)
    // Whole upper half — the sky and the skyline.
    const h=Math.floor(img.height*0.5)
    const d=g.getImageData(0,0,img.width,h).data
    let black=0, minX=1e9, maxX=-1, minY=1e9, maxY=-1
    for(let i=0;i<d.length;i+=4){
      const v=(d[i]+d[i+1]+d[i+2])/3
      if(v<12){ // near-pure black
        black++
        const px=Math.floor((i/4)%img.width), py=Math.floor((i/4)/img.width)
        if(px<minX)minX=px; if(px>maxX)maxX=px; if(py<minY)minY=py; if(py>maxY)maxY=py
      }
    }
    res[k]= black? {blackPx:black, box:[minX,minY,maxX,maxY], frac:+(100*black/(img.width*h)).toFixed(3)}
                 : {blackPx:0}
  }
  return res
}, urls)
await b.close()
console.log('near-black pixels in the UPPER HALF of each frame:')
for(const [k,v] of Object.entries(out)){
  console.log(`  ${k.padEnd(34)} ${v.blackPx? `${String(v.blackPx).padStart(6)} px (${v.frac}%) box ${v.box.join(',')}` : 'none'}`)
}
