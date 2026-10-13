const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
  const win=new BrowserWindow({width:800,height:500,frame:false,show:false,webPreferences:{backgroundThrottling:false}});
  await win.loadURL('data:text/html,'+encodeURIComponent(`<html><head><title>lolPing scroll fixture</title><style>body{margin:0;background:white;overflow-x:hidden}canvas{display:block}header,footer{position:fixed;left:0;right:0;background:#f5f6f8;color:#263747;font:14px sans-serif;z-index:10}header{top:0;height:28px}footer{bottom:0;height:24px}</style></head><body><header>Fixed header — live scroll target</header><footer>Fixed footer — keep only once</footer><canvas id="content" width="800" height="1800"></canvas><script>
  const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
  for(let y=0;y<1800;y++){let seed=(Math.imul(y+1,2654435761)>>>0);seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;ctx.fillStyle='rgb('+(seed&255)+','+((seed>>>8)&255)+','+((seed>>>16)&255)+')';ctx.fillRect(0,y,800,1);}
  for(let y=30;y<1800;y+=100){ctx.fillStyle='#fff';ctx.fillRect(70,y-20,400,35);ctx.fillStyle='#222';ctx.font='24px sans-serif';ctx.fillText('Scroll capture row '+y,80,y+5);}
  </script></body></html>`));
  win.show();win.focus();
});
app.on('window-all-closed',()=>app.quit());
