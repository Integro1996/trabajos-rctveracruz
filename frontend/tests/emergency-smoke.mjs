import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const mammoth=require('mammoth');
const base=process.env.LAB_FRONTEND_URL||'http://localhost:3200';
const browser=await puppeteer.launch({executablePath:process.env.LAB_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--no-proxy-server']});
try{
  const page=await browser.newPage();
  await page.setViewport({width:1440,height:1100});
  let selected;
  page.on('response',async response=>{
    if(/\/api\/lab\/admin\/articles\/[0-9a-f-]+$/.test(response.url())&&response.ok()){
      const data=await response.json().catch(()=>null);if(data?.article)selected=data.article;
    }
  });
  await page.goto(base+'/admin');await page.waitForSelector('#admin-email');
  await page.type('#admin-email',process.env.ADMIN_EMAIL);await page.type('#admin-password',process.env.ADMIN_PASSWORD);
  await page.click('button[type=submit]');await page.waitForSelector('.admin-result');await page.click('.admin-result');await page.waitForSelector('.admin-detail');
  assert(selected?.generatedAt,'El trabajo de prueba debe estar generado');
  const before=selected.version,articleId=selected.id;
  page.on('dialog',dialog=>dialog.accept('Edición de emergencia automatizada en Chrome'));
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='ACCESO DE EMERGENCIA').click());
  await page.waitForSelector('iframe',{timeout:60000});
  const frame=await (await page.$('iframe')).contentFrame();
  await frame.waitForSelector('#area_id',{visible:true,timeout:60000});
  await frame.waitForFunction(()=>!document.querySelector('#loadmask')||getComputedStyle(document.querySelector('#loadmask')).display==='none',{timeout:60000});
  await frame.click('#area_id',{offset:{x:320,y:180}});
  await page.keyboard.down('Control');await page.keyboard.press('End');await page.keyboard.up('Control');
  await page.keyboard.press('Enter');
  const marker='Validacion de emergencia '+Date.now();
  await page.keyboard.type(marker,{delay:50});
  await page.keyboard.down('Control');await page.keyboard.press('s');await page.keyboard.up('Control');
  await new Promise(r=>setTimeout(r,5000));
  await page.click('.back-link');
  const deadline=Date.now()+90000;
  let detail;
  while(Date.now()<deadline){
    detail=await page.evaluate(id=>fetch('/api/lab/admin/articles/'+id).then(r=>r.json()),articleId);
    if(detail.article.version>before)break;
    await new Promise(r=>setTimeout(r,2000));
  }
  assert(detail.article.version>before,'ONLYOFFICE debe guardar por callback al cerrar el editor');
  const bytes=await page.evaluate(id=>fetch('/api/lab/admin/articles/'+id+'/download').then(r=>r.arrayBuffer()).then(b=>Array.from(new Uint8Array(b))),articleId);
  const text=(await mammoth.extractRawText({buffer:Buffer.from(bytes)})).value;
  assert(text.includes(marker),'El DOCX debe contener el texto escrito mediante teclado');
  assert.equal(detail.article.title,selected.title);
  console.log(JSON.stringify({ok:true,articleId,realBrowserEdit:true,callbackVersion:detail.article.version}));
}finally{await browser.close()}
