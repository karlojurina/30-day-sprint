import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--no-sandbox']})
const p = await b.newPage()
const src='data:image/png;base64,'+fs.readFileSync('shots/split-1691x1278-depth0_0708.png').toString('base64')
const out = await p.evaluate(async (s) => {
  const img = await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=s})
  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height
  const g=c.getContext('2d',{willReadFrequently:true}); g.drawImage(img,0,0)
  const px=(x,y)=>{const d=g.getImageData(x,y,1,1).data; return [d[0],d[1],d[2]]}
  // Walk a vertical line through the triangle and a neighbouring line in clear sky.
  const col=[], ref=[]
  for(let y=240;y<=330;y+=10){ col.push(`${y}:${px(870,y).join(',')}`); ref.push(`${y}:${px(1250,y).join(',')}`) }
  return {through:col, beside:ref, size:[img.width,img.height]}
}, src)
await b.close()
console.log('frame', out.size.join('x'))
console.log('\nvertical line x=870 (through the dark shape):')
out.through.forEach(v=>console.log('   y='+v))
console.log('\nvertical line x=1250 (clear sky, same rows):')
out.beside.forEach(v=>console.log('   y='+v))
