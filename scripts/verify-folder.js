'use strict';
const fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
const { Downloader } = require('../src/downloader');
(async()=>{
  const root=path.join(__dirname,'..');
  const [port,ws]=fs.readFileSync(path.join(root,'.wwebjs_auth','session-whatsapp-photo-saver','DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
  const b=await puppeteer.connect({browserWSEndpoint:`ws://127.0.0.1:${port}${ws}`,defaultViewport:null,protocolTimeout:120000});
  const page=(await b.pages()).find(x=>x.url().includes('whatsapp.com'));
  const status=await (await fetch('http://localhost:3000/api/status')).json();
  const home=status.groups.find(g=>g.name==='Home')||status.groups[0];
  const raw=await page.evaluate(async (groupId)=>{
    const L=window.require('WAWebChatLoadMessages');
    const chat=await window.WWebJS.getChat(groupId,{getAsModel:false});
    await Promise.race([L.loadEarlierMsgs({chat}),new Promise((_,r)=>setTimeout(()=>r(new Error('t')),15000))]).catch(()=>{});
    const m=chat.msgs.getModelsArray().filter(x=>x.type==='image'&&x.directPath&&['INIT','RESOLVED'].includes(x.mediaData&&x.mediaData.mediaStage)).slice(-1)[0];
    if(!m) return null;
    return {id:String(m.id),type:'image',directPath:m.directPath,mimetype:m.mimetype||'image/jpeg',t:m.t||null,author:m.author||null,body:'Site / progress: 50% "done"?'};
  }, home.id);
  if(!raw){console.log('no fresh image');await b.disconnect();return;}
  const tmp=path.join(root,'.e2e-tmp'); fs.rmSync(tmp,{recursive:true,force:true}); fs.mkdirSync(tmp,{recursive:true});
  const seen=new Map(); const store={has:k=>seen.has(k),mark:(k,v)=>seen.set(k,v)};
  const cfg={downloadDir:tmp,includeImages:true,includeVideos:true,includeStickers:false,includeDocuments:false,saveCaptionToMetadata:true};
  const dl=new Downloader({client:{pupPage:page},store,config:cfg,onEvent:()=>{}});
  const message={_data:{...raw},id:{_serialized:raw.id},type:'image',timestamp:raw.t,author:raw.author,body:raw.body};
  await dl.process(message,{groupName:'Home',senderName:'Mark Tester'});
  const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const f of walk(tmp)){ const buf=fs.readFileSync(f); console.log(JSON.stringify({rel:path.relative(tmp,f),bytes:buf.length,isJpeg:buf.slice(0,3).toString('hex')==='ffd8ff'})); }
  fs.rmSync(tmp,{recursive:true,force:true});
  await b.disconnect();
})().catch(e=>{console.error('FAILED:',e.message);process.exit(1)});
