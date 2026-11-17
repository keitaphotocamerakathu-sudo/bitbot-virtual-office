// Animated presentation of recorded work. No HTTP, credentials or trading calls.
import {DEPARTMENTS} from './company.mjs?v=14.0.0';
import {createOfficeLayout,findPath,visitPoint,officeHandoffs,workerId,workerRole,OFFICE_NAMES} from './office-model.mjs?v=20.0.0';
const WIDTH=1400,HEIGHT=850;
const project=(x,y,z=0)=>({x:560+(x-y)*24,y:64+(x+y)*12-z});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),clockText=t=>new Date(t).toLocaleTimeString('th-TH',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const hash=s=>[...s].reduce((h,c)=>(h*31+c.charCodeAt(0))>>>0,7);
export class VirtualOffice{
 constructor(canvas,onSelect,{onEvent=()=>{},onState=()=>{}}={}){
  this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.onEvent=onEvent;this.onState=onState;this.layout=createOfficeLayout();this.actors=new Map();this.archive=null;this.pendingArchive=null;this.events=[];this.motion=true;this.playing=false;this.speed=1;this.time=0;this.lastTime=null;this.nextAmbient=0;this.nextReplay=0;this.hits=[];this.frameCount=0;this.camera={zoom:1,x:0,y:0};this.follow=false;this.lastManual=-100;this.snapshotVersion=0;
  this.background=document.createElement('canvas');this.background.width=WIDTH;this.background.height=HEIGHT;this.paintBackground();
  this.resize=()=>{const box=canvas.getBoundingClientRect();this.width=Math.max(200,box.width);this.height=Math.max(260,box.height);const dpr=Math.min(2,globalThis.devicePixelRatio||1);canvas.width=Math.round(this.width*dpr);canvas.height=Math.round(this.height*dpr);this.dpr=dpr;this.base=Math.min(this.width/WIDTH,this.height/HEIGHT);if(box.width>0&&(!this.resized||this.narrow!==(this.width<600))){this.narrow=this.width<600;this.camera.zoom=this.narrow?2.1:1;this.follow=this.narrow;this.camera.x=this.camera.y=0;this.resized=true;}this.drawn=false;};
  this.observer=new ResizeObserver(this.resize);this.observer.observe(canvas);this.resize();
  this.down=e=>{this.drag={x:e.clientX,y:e.clientY,px:this.camera.x,py:this.camera.y,moved:false};canvas.setPointerCapture?.(e.pointerId);};
  this.move=e=>{if(!this.drag)return;const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y;if(Math.hypot(dx,dy)>5)this.drag.moved=true;if(this.drag.moved){this.camera.x=this.drag.px+dx;this.camera.y=this.drag.py+dy;this.lastManual=this.time;this.drawn=false;}};
  this.up=e=>{if(!this.drag)return;const moved=this.drag.moved;this.drag=null;if(moved)return;const b=canvas.getBoundingClientRect(),p={x:e.clientX-b.left,y:e.clientY-b.top},hit=this.hits.filter(h=>Math.hypot(h.x-p.x,h.y-p.y)<Math.max(16,h.radius)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(hit)this.onSelect({...hit.actor.worker,visualActivity:hit.actor.activity,visualSourceAt:this.current?.event.sourceAt||this.archive?.finishedAt,demo:this.demo});};
  this.wheel=e=>{if(!e.ctrlKey)return;e.preventDefault();this.zoom(e.deltaY<0?1.15:1/1.15);};
  this.key=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-',' '].includes(e.key)){e.preventDefault();if(e.key===' ')this.setMotion(!this.motion);else if(e.key==='+')this.zoom(1.2);else if(e.key==='-')this.zoom(1/1.2);else{this.camera.x+=e.key==='ArrowLeft'?35:e.key==='ArrowRight'?-35:0;this.camera.y+=e.key==='ArrowUp'?35:e.key==='ArrowDown'?-35:0;this.lastManual=this.time;this.drawn=false;}}};
  canvas.addEventListener('pointerdown',this.down);canvas.addEventListener('pointermove',this.move);canvas.addEventListener('pointerup',this.up);canvas.addEventListener('pointercancel',()=>this.drag=null);canvas.addEventListener('wheel',this.wheel,{passive:false});canvas.addEventListener('keydown',this.key);
  this.tick=this.tick.bind(this);this.frame=requestAnimationFrame(this.tick);
 }
 setData(workers,archive,runtime={}){
  this.runtime=runtime;this.demo=runtime.preview===true||!workers?.length;
  const list=workers?.length?workers:DEPARTMENTS.map(d=>({worker_id:d.id+'-demo',role:d.id,status:'DEMO',tools:[]}));
  const ids=new Set(list.map(workerId));for(const [id] of this.actors)if(!ids.has(id))this.actors.delete(id);
  for(const w of list){const id=workerId(w),r=this.layout.rooms.find(r=>r.id===workerRole(w));if(!r)continue;const unit=Number(id.split('-').at(-1))||1,home={...r.homes[(unit-1)%r.homes.length]};const a=this.actors.get(id);if(a)a.worker=w;else this.actors.set(id,{id,worker:w,role:r.id,color:r.color,home,...home,path:[],locked:false,activity:this.demo?'ตัวอย่างบรรยากาศ':'รอรอบข้อมูล',seed:hash(id),restUntil:0});}
  const changed=this.latestKey!==(archive?archive.mode+':'+archive.finishedAt:null);if(changed){this.latestKey=archive?archive.mode+':'+archive.finishedAt:null;this.pendingArchive=archive;this.hasPending=true;if(!this.current)this.adoptArchive();}
  if(!archive&&this.archive){this.current=null;this.archive=null;this.events=[];this.playing=false;for(const a of this.actors.values()){a.locked=false;a.path=[];}}
  this.drawn=false;
 }
 adoptArchive(){this.archive=this.pendingArchive;this.hasPending=false;this.pendingArchive=null;this.events=officeHandoffs(this.archive,[...this.actors.values()].map(a=>a.worker));this.index=0;this.nextReplay=this.time+.8;this.playing=!!this.events.length;this.loop=0;}
 replay(){if(!this.archive?.messages?.length)return;this.releaseCurrent();this.events=officeHandoffs(this.archive,[...this.actors.values()].map(a=>a.worker));this.index=0;this.nextReplay=this.time;this.playing=true;this.loop=0;this.drawn=false;}
 releaseCurrent(){if(this.current){for(const id of [this.current.event.from,this.current.event.to]){const a=this.actors.get(id);if(a){a.locked=false;this.walk(a,a.home,'กลับโต๊ะ');}}this.current=null;}}
 setMotion(value){this.motion=!!value;this.drawn=false;this.emitState();}
 zoom(factor){this.camera.zoom=Math.max(.8,Math.min(4.5,this.camera.zoom*factor));this.lastManual=this.time;this.drawn=false;}
 fit(){this.camera={zoom:1,x:0,y:0};this.follow=false;this.lastManual=this.time;this.drawn=false;}
 setSpeed(value){this.speed=Math.max(.5,Math.min(3,Number(value)||1));}
 walk(actor,target,activity){const path=findPath(this.layout,actor,target);actor.path=path;actor.activity=activity;return path.length>0;}
 beginHandoff(event){const from=this.actors.get(event.from),to=this.actors.get(event.to);if(!from||!to)return;from.locked=true;to.locked=true;from.ambient=to.ambient=false;from.restUntil=to.restUntil=0;to.path=[];from.path=[];
  const meeting=['cio','quant','risk','portfolio'].includes(from.role)&&this.index%2===1;
  if(meeting){this.walk(from,{x:12.5,y:10.5},'ไปโต๊ะประชุม');this.walk(to,{x:18.5,y:10.5},'ไปโต๊ะประชุม');}else{this.walk(from,visitPoint(this.layout,to,from),'เดินส่งผลที่บันทึก');to.activity='รอรับผลที่บันทึก';}
  this.current={event,phase:'travel',at:this.time,meeting};this.onEvent({...event,stage:'WALK',speaker:event.from,text:event.summary,recorded:true});
 }
 speak(speaker,text,phase){const a=this.actors.get(speaker);if(a)a.activity='สนทนาจากบันทึก';this.current.phase=phase;this.current.at=this.time;this.current.speaker=speaker;this.current.text=text;this.current.duration=Math.max(3.2,Math.min(7,text.length/25));this.onEvent({...this.current.event,stage:'SPEAK',speaker,text,taskId:phase==='recipient'?this.current.event.replyTaskId:this.current.event.taskId,recorded:true});}
 advance(dt){
  this.time+=dt*this.speed;
  for(const a of this.actors.values()){
   let remaining=dt*this.speed*3.8;a.moving=!!a.path.length;
   while(a.path.length&&remaining>0){const target=a.path[0],d=distance(a,target);if(d<.001){a.x=target.x;a.y=target.y;a.path.shift();continue;}a.facing=target.x-a.x-(target.y-a.y);const n=Math.min(d,remaining);a.x+=(target.x-a.x)/d*n;a.y+=(target.y-a.y)/d*n;remaining-=n;if(d<=n+.001)a.path.shift();}
   if(!a.locked&&!a.path.length&&a.ambient&&!a.restUntil){a.restUntil=this.time+3.5;a.activity=this.demo?'พักรอ · ตัวอย่าง':'พักรอรอบ · ภาพบรรยากาศ';}
   if(!a.locked&&a.restUntil&&this.time>a.restUntil){a.restUntil=0;a.ambient=false;this.walk(a,a.home,'กลับโต๊ะ · ภาพบรรยากาศ');}
  }
  const c=this.current;
  if(c){const from=this.actors.get(c.event.from),to=this.actors.get(c.event.to);if(!from||!to){this.current=null;return;}
   if(c.phase==='travel'&&!from.path.length&&!to.path.length)this.speak(c.event.from,c.event.summary,'sender');
   else if(c.phase==='sender'&&this.time-c.at>c.duration){if(c.event.reply)this.speak(c.event.to,c.event.reply,'recipient');else{c.phase='return';c.speaker=null;this.walk(from,from.home,'กลับโต๊ะ');this.walk(to,to.home,'กลับโต๊ะ');}}
   else if(c.phase==='recipient'&&this.time-c.at>c.duration){c.phase='return';c.speaker=null;this.walk(from,from.home,'กลับโต๊ะ');this.walk(to,to.home,'กลับโต๊ะ');}
   else if(c.phase==='return'&&!from.path.length&&!to.path.length){from.locked=false;to.locked=false;from.activity=to.activity='รอรอบข้อมูล';this.current=null;this.index++;if(this.hasPending)this.adoptArchive();else if(this.index>=this.events.length){this.playing=false;this.nextReplay=this.time+10;}}
  }else if(this.hasPending)this.adoptArchive();
  else if(this.events.length&&this.time>=this.nextReplay){if(this.index>=this.events.length){this.index=0;this.loop++;}this.playing=true;this.beginHandoff(this.events[this.index]);}
  if(this.time>=this.nextAmbient){this.nextAmbient=this.time+3;const free=[...this.actors.values()].filter(a=>!a.locked&&!a.path.length&&!a.ambient&&!a.restUntil),walking=[...this.actors.values()].filter(a=>a.path.length).length;
   if(free.length&&walking<4){const a=free[Math.floor(this.time/3)%free.length],target=this.layout.breakSpots[(a.seed+Math.floor(this.time/9))%this.layout.breakSpots.length];a.ambient=true;this.walk(a,target,this.demo?'เดินพัก · ตัวอย่าง':'เดินพัก · ภาพบรรยากาศ');}
  }
 }
 screen(p){const scale=this.base*this.camera.zoom;return{x:this.width/2+this.camera.x+(p.x-WIDTH/2)*scale,y:this.height/2+this.camera.y+(p.y-HEIGHT/2)*scale};}
 emitState(){const s={moving:[...this.actors.values()].filter(a=>a.path.length).length,workers:this.actors.size,motion:this.motion,demo:this.demo,phase:this.current?.phase||'ambient',sourceAt:this.current?.event.sourceAt||this.archive?.finishedAt||null,from:this.current?.event.from,to:this.current?.event.to,speaker:this.current?.speaker,loop:this.loop||0};this.canvas.dataset.walkers=String(s.moving);this.canvas.dataset.scenePhase=s.phase;this.canvas.dataset.motion=String(this.motion);this.onState(s);return s;}
 tick(now){this.frame=requestAnimationFrame(this.tick);if(document.hidden||this.canvas.closest('[hidden]')){this.lastTime=now;return;}if(this.lastDraw&&now-this.lastDraw<32)return;this.lastDraw=now;const dt=this.lastTime===null?0:Math.min(.1,(now-this.lastTime)/1000);this.lastTime=now;if(this.motion)this.advance(dt);if(this.motion||!this.drawn){this.draw();this.drawn=true;this.frameCount++;this.canvas.dataset.frames=String(this.frameCount);}if(!this.lastEmit||now-this.lastEmit>500){this.emitState();this.lastEmit=now;}}
 polygon(c,points,fill,stroke){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
 floor(c,x,y,w,h,color,z=0,stroke){this.polygon(c,[project(x,y,z),project(x+w,y,z),project(x+w,y+h,z),project(x,y+h,z)],color,stroke);}
 box(c,x,y,w,h,height,top='#c4ad8c',side='#827465',z=0){const p=[project(x,y,z),project(x+w,y,z),project(x+w,y+h,z),project(x,y+h,z)],a=p.map(p=>({x:p.x,y:p.y-height}));this.polygon(c,[a[1],a[2],p[2],p[1]],side);this.polygon(c,[a[2],a[3],p[3],p[2]],side);this.polygon(c,a,top,'#ffffff18');}
 text(c,text,x,y,size=13,color='#dee9eb',weight=400){c.font=weight+' '+size+'px system-ui';c.fillStyle=color;c.fillText(text,x,y);}
 plant(c,x,y){const p=project(x,y);this.box(c,x-.2,y-.2,.4,.4,12,'#d3c2a0','#8e816c');c.strokeStyle='#507d62';c.lineWidth=3;c.beginPath();c.moveTo(p.x,p.y-13);c.lineTo(p.x,p.y-38);c.stroke();for(let i=0;i<5;i++){c.fillStyle=i%2?'#6f9c74':'#3f725c';c.beginPath();c.ellipse(p.x+Math.sin(i*2)*9,p.y-23-i*3,10,4,i,0,Math.PI*2);c.fill();}}
 chair(c,x,y){const p=project(x,y);c.strokeStyle='#3c4756';c.lineWidth=2;for(const dx of [-10,0,10]){c.beginPath();c.moveTo(p.x,p.y-5);c.lineTo(p.x+dx,p.y+4);c.stroke();}this.box(c,x-.3,y-.2,.6,.5,10,'#354c5d','#253441');c.fillStyle='#40586a';c.beginPath();c.roundRect(p.x-10,p.y-27,18,18,5);c.fill();}
 desk(c,x,y){this.box(c,x,y,2,1,22,'#bbad94','#7a7468');const p=project(x+.65,y+.25,22);c.fillStyle='#273c47';c.fillRect(p.x-18,p.y-24,38,24);c.fillStyle='#101e2b';c.fillRect(p.x-15,p.y-21,32,17);c.fillStyle='#659d99';for(let i=0;i<5;i++)c.fillRect(p.x-12+i*5,p.y-17+(i%2)*3,3,8-i%3);c.strokeStyle='#5c7376';c.lineWidth=3;c.beginPath();c.moveTo(p.x,p.y);c.lineTo(p.x,p.y+5);c.stroke();this.floor(c,x+.6,y+.7,.8,.2,'#5b6469',24);this.floor(c,x+1.55,y+.4,.3,.35,'#ede7d2',24);const mug=project(x+.3,y+.7,27);c.fillStyle='#efddd1';c.fillRect(mug.x-3,mug.y-5,6,7);}
 paintBackground(){const c=this.background.getContext('2d');c.clearRect(0,0,WIDTH,HEIGHT);const bg=c.createLinearGradient(0,0,0,HEIGHT);bg.addColorStop(0,'#13222e');bg.addColorStop(1,'#0c1721');c.fillStyle=bg;c.fillRect(0,0,WIDTH,HEIGHT);
  this.box(c,0,0,30,22,10,'#b1b3a7','#536573',-10);this.floor(c,0,0,30,22,'#b8b5a7',0,'#ccd4ca');
  for(let x=0;x<30;x++)for(let y=0;y<22;y++)this.floor(c,x,y,1,1,(x+y)%2?'#b8b5a7':'#b4b3a6',0,'#d6d4c322');
  // Tall windows on the rear edge, with the foreground cut away for visibility.
  for(let x=0;x<30;x+=3){const a=project(x,0),b=project(x+2.8,0);this.polygon(c,[{x:a.x,y:a.y-84},{x:b.x,y:b.y-84},b,a],'#456c7f80','#73949c');this.polygon(c,[{x:a.x+4,y:a.y-78},{x:b.x-4,y:b.y-78},{x:b.x-4,y:b.y-25},{x:a.x+4,y:a.y-25}],'#73939955');}
  this.floor(c,0,8,30,6,'#798f91');for(let x=0;x<30;x+=2)this.floor(c,x,12,1.95,.08,'#a4b4ac');
  for(const r of this.layout.rooms){this.floor(c,r.x+.15,r.y+.15,5.7,7.7,'#687c7c');this.floor(c,r.x+.35,r.y+.4,5.3,6.8,r.color+'24');
   const a=project(r.x,r.y),b=project(r.x+5.9,r.y);this.polygon(c,[{x:a.x,y:a.y-35},{x:b.x,y:b.y-35},b,a],'#47637670','#82a4ad55');
   if(r.x>0){const d=project(r.x,r.y+7.8);this.polygon(c,[{x:a.x,y:a.y-35},{x:d.x,y:d.y-35},d,a],'#506c7950','#84a1a755');}
   this.desk(c,r.x+1,r.y+2);this.desk(c,r.x+1,r.y+5);this.chair(c,r.x+1.5,r.y+3.5);this.chair(c,r.x+1.5,r.y+6.5);
   this.box(c,r.x+4,r.y+1.1,.7,1.6,20,'#8e9b9c','#526a73');this.plant(c,r.x+4.1,r.y+6.7);
   const p=project(r.x+2.4,r.y+.6,42);this.text(c,r.name,p.x-27,p.y,13,r.color,700);this.text(c,OFFICE_NAMES[r.id],p.x-27,p.y+15,10,'#c6d6d7');
   const door=project(r.door.x+.5,r.door.y+.5);this.floor(c,r.door.x,r.door.y,1,1,'#c2d2b680');c.fillStyle=r.color;c.beginPath();c.arc(door.x,door.y,2,0,Math.PI*2);c.fill();
  }
  // Meeting table, chairs, coffee bar and a small lounge.
  for(const [x,y] of [[12.5,10.5],[12.5,11.5],[18.5,10.5],[18.5,11.5],[14.5,9],[16.5,12.5]])this.chair(c,x,y);
  this.box(c,13,10,5,2,23,'#c9a57a','#8d7764');this.floor(c,14,10.5,1.4,.7,'#45555a',25);this.floor(c,16.3,10.4,.65,.8,'#eee6d7',25);
  this.box(c,24,9,4,1,30,'#c1b7a2','#5b716f');this.box(c,25,9.1,.7,.6,21,'#2d4148','#23333d',30);this.plant(c,28.4,9.5);
  this.box(c,2,9,4,1,15,'#476a70','#36505b');this.box(c,2,9,4,.3,32,'#5c7c7d','#36505b');this.box(c,3,11,1.5,.8,12,'#c6b594','#8b826e');this.plant(c,1.1,11.8);
  this.box(c,25,12,3,.7,24,'#acb5a4','#647c77');
  const m=project(14,8.2,17),k=project(25,8.2,20),l=project(2,8.2,20);this.text(c,'TEAM BRIEFING',m.x,m.y,13,'#e6eee5',700);this.text(c,'COFFEE / BREAK',k.x,k.y,12,'#d5e3db',600);this.text(c,'LOUNGE',l.x,l.y,12,'#d5e3db',600);
  this.text(c,'BITBOT  /  TRADING COMPANY',440,800,16,'#83a5ad',600);this.text(c,'SHARED WORKSPACE  •  RECORDED TEAM TASKS',490,821,10,'#587c89');
 }
 actor(c,a){const p=project(a.x,a.y),walking=a.path.length>0,step=walking?Math.sin(this.time*12+a.seed):0,bob=walking?Math.abs(step)*1.6:Math.sin(this.time*2+a.seed)*.4,talking=this.current?.speaker===a.id&&['sender','recipient'].includes(this.current.phase),skin=['#e2bda0','#c69274','#9e715b'][a.seed%3];
  c.fillStyle='#10202b55';c.beginPath();c.ellipse(p.x,p.y+2,13,6,0,0,Math.PI*2);c.fill();c.lineCap='round';c.strokeStyle='#263448';c.lineWidth=5;for(const side of [-1,1]){c.beginPath();c.moveTo(p.x+side*4,p.y-10+bob);c.lineTo(p.x+side*5+side*step*4,p.y+2);c.stroke();}c.strokeStyle='#152934';c.lineWidth=4;for(const side of [-1,1]){c.beginPath();c.moveTo(p.x+side*5+side*step*4,p.y+2);c.lineTo(p.x+side*5+side*step*4+3,p.y+3);c.stroke();}
  c.fillStyle=a.color;c.beginPath();c.roundRect(p.x-9,p.y-29+bob,18,22,5);c.fill();c.fillStyle='#eef1e8';this.polygon(c,[{x:p.x-5,y:p.y-29+bob},{x:p.x+5,y:p.y-29+bob},{x:p.x,y:p.y-21+bob}],'#eef1e8');
  c.lineWidth=4;for(const side of [-1,1]){const wave=talking&&side===1?Math.sin(this.time*9)*5:step*5*side;c.strokeStyle=a.color;c.beginPath();c.moveTo(p.x+side*8,p.y-26+bob);c.lineTo(p.x+side*12,p.y-16+bob+wave);c.stroke();c.fillStyle=skin;c.beginPath();c.arc(p.x+side*12,p.y-15+bob+wave,2.8,0,Math.PI*2);c.fill();}
  c.fillStyle=skin;c.beginPath();c.arc(p.x,p.y-37+bob,9,0,Math.PI*2);c.fill();c.fillStyle=['#29303a','#513e32','#302f35'][a.seed%3];c.beginPath();c.ellipse(p.x-1,p.y-42+bob,9.5,5,0,0,Math.PI*2);c.fill();if(a.seed%3===0)c.fillRect(p.x-9,p.y-41+bob,4,14);c.fillStyle='#324049';c.fillRect(p.x+(a.facing<0?-5:2),p.y-38+bob,2,2);if(talking){c.fillStyle='#835d51';c.beginPath();c.ellipse(p.x+1,p.y-32+bob,2,1+Math.abs(Math.sin(this.time*13)),0,0,Math.PI*2);c.fill();}
  if(a.locked&&this.current?.event.from===a.id){c.fillStyle='#edf1d9';c.fillRect(p.x+8,p.y-20+bob,12,9);c.strokeStyle='#9fbaa9';c.lineWidth=1;c.strokeRect(p.x+8,p.y-20+bob,12,9);}
  if(a.worker.status==='FAILED'){c.fillStyle='#f89d9c';c.beginPath();c.arc(p.x+12,p.y-45,4,0,Math.PI*2);c.fill();}
  return p;
 }
 wrap(c,text,width){const lines=[];let line='';for(const letter of String(text)){if(c.measureText(line+letter).width>width&&line){lines.push(line);line=letter;}else line+=letter;if(lines.length===4)break;}if(line)lines.push(line);return lines;}
 bubble(actor,text,header,reveal=true){const c=this.ctx,p=this.screen(project(actor.x,actor.y,57)),w=Math.min(310,this.width-24);if(p.x<0||p.x>this.width||p.y<0||p.y>this.height)return;c.font='12px system-ui';const message=reveal?String(text).slice(0,Math.max(2,Math.floor((this.time-this.current.at)*38))):text,lines=this.wrap(c,message,w-28),h=39+lines.length*18,x=Math.max(12,Math.min(this.width-w-12,p.x-w/2)),y=Math.max(46,Math.min(this.height-h-12,p.y-h-10));
  c.fillStyle='#eef6ed';c.shadowColor='#08101c55';c.shadowBlur=16;c.beginPath();c.roundRect(x,y,w,h,10);c.fill();c.shadowBlur=0;this.polygon(c,[{x:Math.max(x+15,Math.min(x+w-15,p.x))-6,y:y+h-1},{x:Math.max(x+15,Math.min(x+w-15,p.x))+6,y:y+h-1},{x:p.x,y:Math.min(this.height-8,p.y)}],'#eef6ed');this.text(c,header,x+14,y+20,10,'#537264',600);lines.forEach((line,i)=>this.text(c,line,x+14,y+41+i*18,12,'#163b33'));
 }
 draw(){const c=this.ctx;c.setTransform(this.dpr,0,0,this.dpr,0,0);c.clearRect(0,0,this.width,this.height);c.fillStyle='#0d1925';c.fillRect(0,0,this.width,this.height);
  const focus=this.current?.speaker||this.current?.event.from,a=focus&&this.actors.get(focus);if(this.follow&&a&&this.motion&&this.time-this.lastManual>8){const p=project(a.x,a.y,35),s=this.base*this.camera.zoom;this.camera.x+=(-(p.x-WIDTH/2)*s-this.camera.x)*.045;this.camera.y+=(-(p.y-HEIGHT/2)*s+40-this.camera.y)*.045;}
  const scale=this.base*this.camera.zoom;c.save();c.translate(this.width/2+this.camera.x,this.height/2+this.camera.y);c.scale(scale,scale);c.translate(-WIDTH/2,-HEIGHT/2);c.drawImage(this.background,0,0);this.hits=[];
  for(const actor of [...this.actors.values()].sort((a,b)=>a.x+a.y-b.x-b.y)){const p=this.actor(c,actor),v=this.screen(p);this.hits.push({x:v.x,y:v.y-20*scale,radius:20*scale,actor});if(actor.locked){const ring=project(actor.x,actor.y);c.strokeStyle=actor.color+'cc';c.lineWidth=1.5;c.beginPath();c.ellipse(ring.x,ring.y+2,18,8,0,0,Math.PI*2);c.stroke();}}
  c.restore();
  c.fillStyle='#112330e8';c.beginPath();c.roundRect(12,12,Math.min(this.width-24,510),29,7);c.fill();this.text(c,this.demo?'ตัวอย่างบรรยากาศ • ยังไม่เชื่อม Worker ของบัญชี':this.current?'เล่นการส่งงานจากบันทึก '+clockText(this.current.event.sourceAt)+(this.loop?' • เล่นซ้ำ':''):'บรรยากาศออฟฟิศ • รอการส่งงานจากบันทึก',23,31,11,this.demo?'#edc590':'#a8e4ca',600);
  if(this.current?.speaker){const actor=this.actors.get(this.current.speaker);if(actor)this.bubble(actor,this.current.text,OFFICE_NAMES[actor.role]+' • สรุปงาน #'+(this.current.phase==='recipient'?this.current.event.replyTaskId:this.current.event.taskId));}
  else if(this.current?.phase==='travel'){const actor=this.actors.get(this.current.event.from);if(actor)this.bubble(actor,'เดินไปส่งผลให้ฝ่าย'+(OFFICE_NAMES[this.actors.get(this.current.event.to)?.role]||this.current.event.to), 'บันทึก '+clockText(this.current.event.sourceAt),false);}
  c.fillStyle='#0b1725c9';c.fillRect(0,this.height-25,this.width,25);this.text(c,this.motion?'ลากเพื่อเลื่อน • + / − เพื่อซูม • คลิกตัวละครเพื่อดูงาน':'พักภาพเคลื่อนไหว • Trading Engine ทำงานแยกบน Cloud',12,this.height-9,10,'#adbfca');
 }
 destroy(){cancelAnimationFrame(this.frame);this.observer.disconnect();for(const [event,fn] of [['pointerdown',this.down],['pointermove',this.move],['pointerup',this.up],['wheel',this.wheel],['keydown',this.key]])this.canvas.removeEventListener(event,fn);}
}
