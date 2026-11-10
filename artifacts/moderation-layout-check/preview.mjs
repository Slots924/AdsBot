import { createServer } from '../../frontend/node_modules/vite/dist/node/index.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';

// Перевіряємо справжню картку на вигаданих даних без зовнішніх запитів.
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {PageCard} from '/src/tabs/PagesTab.jsx';
import '/src/styles/shared-ui.css'; import '/src/styles/app.css';
window.selected=0; window.toggled=0;
const pages=Object.fromEntries([1,2,3,4,5].map(id=>[id,{enabled:id===2,integrationReady:id!==3}]));
const moderation={status:'ready',pages,busy:{4:true},errors:{5:{message:'Тестова помилка'}},toggle:()=>window.toggled++,check:()=>{},refresh:()=>{}};
createRoot(document.getElementById('root')).render(<div className='page-workspace'><div className='ad-layout'><div className='panel'><div className='ad-account-scroll'>{[1,2,3,4,5].map(id=><PageCard key={id} page={{id:String(id),name:id===2?'Дуже довга тестова назва фанпейджі для перевірки обрізання':'Тестова фанпейджа',geo:'DE',creativeName:'133',isFavorite:id===2}} selected={id===2} checked={false} onSelect={()=>window.selected++} onCheck={()=>{}} onFavorite={()=>{}} moderation={moderation}/>)}</div></div><div>Деталі фанпейджі</div></div></div>);`;
const server=await createServer({root:path.resolve('frontend'),server:{host:'127.0.0.1',port:5189,strictPort:false,open:false},plugins:[{name:'moderation-preview',enforce:'pre',resolveId(id){if(id==='/__moderation.jsx')return path.resolve('frontend/__moderation.jsx');},load(id){if(id.replaceAll('\\','/').endsWith('/__moderation.jsx'))return fixture;},transform(code,id){if(id.replaceAll('\\','/').endsWith('/src/tabs/PagesTab.jsx'))return code+'\nexport { PageCard };';},configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/__moderation')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/__moderation.jsx"></script></body></html>'));});}}]});
try {await server.listen();const require=createRequire(path.resolve('frontend/package.json'));const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const result=await promisify(execFile)(require('electron'),[path.resolve('artifacts/moderation-layout-check/review.cjs'),`http://127.0.0.1:${server.httpServer.address().port}/__moderation`],{env,windowsHide:true,timeout:60000});console.log(result.stdout);} finally {await server.close();}
