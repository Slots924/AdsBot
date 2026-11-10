const {app,BrowserWindow}=require('electron');
const {writeFile}=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(__dirname,'browser'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1440,height:900,useContentSize:true,webPreferences:{offscreen:true,backgroundThrottling:false}});
 try {for(const width of [1440,1100,980,800,520]){
  win.setContentSize(width,900);await win.loadURL(process.argv[2]);await new Promise(r=>setTimeout(r,1000));
  const result=await win.webContents.executeJavaScript(`(()=>{const rows=[...document.querySelectorAll('.page-card')];return rows.map(row=>{const control=row.querySelector('.myraha-control').getBoundingClientRect(),avatar=row.querySelector('.page-avatar').getBoundingClientRect(),rect=row.getBoundingClientRect();const children=[...row.children].map(el=>el.getBoundingClientRect());return {left:control.right<=avatar.left,aligned:Math.abs(control.top-avatar.top)<1,height:rect.height,overflow:row.scrollWidth>row.clientWidth,overlaps:children.some((r,i)=>i&&r.left<children[i-1].right-1),statusHidden:row.querySelector('small[id]').getBoundingClientRect().width===1};});})()`);
  assert.equal(result.length,5);for(const r of result){assert.equal(r.left,true);assert.equal(r.aligned,true);assert.equal(r.height,52);assert.equal(r.overflow,false);assert.equal(r.overlaps,false);assert.equal(r.statusHidden,true);}
  await win.webContents.executeJavaScript(`document.querySelector('[role="switch"]').click()`);
  assert.deepEqual(await win.webContents.executeJavaScript(`({selected:window.selected,toggled:window.toggled})`),{selected:0,toggled:1});
  await writeFile(path.join(__dirname,`preview-${width}.png`),(await win.webContents.capturePage()).toPNG());console.log(width+': geometry, states, click isolation OK');
 }}finally{win.destroy();}
}).then(()=>app.exit(0)).catch(e=>{console.error(e);app.exit(1)});
