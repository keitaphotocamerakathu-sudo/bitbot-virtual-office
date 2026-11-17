// Display-only isometric office. Recorded jobs drive playback; canvas never places orders.
import {DEPARTMENTS} from './company.mjs?v=14.0.0';
const point=(x,y)=>({x:600+(x-y)*31,y:55+(x+y)*16});
const room=d=>{const i=DEPARTMENTS.findIndex(x=>x.id===d);return{x:(i%5)*3.65,y:Math.floor(i/5)*7.3,w:3.35,h:6.6};};
export class VirtualOffice{
 constructor(canvas,onSelect){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onSelect=onSelect;this.workers=[];this.archive=null;this.playing=false;this.hits=[];this.canvas.width=1200;this.canvas.height=690;this.tick=this.tick.bind(this);this.frame=requestAnimationFrame(this.tick);
 this.click=e=>{const box=this.canvas.getBoundingClientRect(),x=(e.clientX-box.left)/box.width*1200,y=(e.clientY-box.top)/box.height*690;const hit=this.hits.find(h=>Math.hypot(h.x-x,h.y-y)<25);if(hit)this.onSelect(hit.worker);};canvas.addEventListener('click',this.click);
 this.visibility=()=>{if(document.hidden)this.playing=false;};document.addEventListener('visibilitychange',this.visibility);}
 setData(workers,archive){this.drawn=false;this.workers=workers||[];if(this.archive?.finishedAt!==archive?.finishedAt){this.archive=archive;this.playing=false;}}
 replay(){if(!this.archive?.tasks?.length)return;this.playing=true;this.started=performance.now();}
 destroy(){cancelAnimationFrame(this.frame);this.canvas.removeEventListener('click',this.click);document.removeEventListener('visibilitychange',this.visibility);}
 poly(points,fill,stroke='#344654'){const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle=fill;c.fill();c.strokeStyle=stroke;c.stroke();}
 label(text,x,y,size=12,color='#c0d2df'){const c=this.ctx;c.font=size+'px system-ui';c.fillStyle=color;c.fillText(String(text).slice(0,86),x,y);}
 tick(now){if(!document.hidden&&(this.motion!==false||!this.drawn)){this.draw(now);this.drawn=true;}this.frame=requestAnimationFrame(this.tick);}
 draw(now){const c=this.ctx;c.clearRect(0,0,1200,690);c.fillStyle='#0b1320';c.fillRect(0,0,1200,690);
 this.poly([point(-.7,-.7),point(19,-.7),point(19,15),point(-.7,15)],'#142231','#3c5b69');
 const tasks=this.archive?.tasks||[],index=this.playing?Math.floor((now-this.started)/1400):-1,active=tasks[index];if(this.playing&&index>=tasks.length)this.playing=false;
 this.label(this.playing?'REPLAY · บันทึกงานจริง (ยืดเวลาเพื่ออ่าน)':'OFFICE · สถานะล่าสุดจากเซิร์ฟเวอร์',24,30,14,'#a7f2ce');
 this.label(this.archive?'รอบ '+new Date(this.archive.finishedAt).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})+' · '+this.archive.mode:'เข้าสู่ระบบและเรียกวิเคราะห์เพื่อสร้างบันทึกงาน',24,53,11);
 for(const d of DEPARTMENTS){const r=room(d.id),p1=point(r.x,r.y),p2=point(r.x+r.w,r.y),p3=point(r.x+r.w,r.y+r.h),p4=point(r.x,r.y+r.h),busy=active?.role===d.id;
 this.poly([p1,p2,p3,p4],busy?'#253e43':'#1a2b3b',d.color+'80');
 this.poly([{x:p1.x,y:p1.y-25},{x:p2.x,y:p2.y-25},p2,p1],'#293e50');
 this.label(d.name,p1.x+5,p1.y+20,10,d.color);
 for(let n=0;n<3;n++){const a=point(r.x+.5,r.y+1.7+n*1.35),b=point(r.x+2.6,r.y+1.7+n*1.35),e=point(r.x+2.6,r.y+2.35+n*1.35),f=point(r.x+.5,r.y+2.35+n*1.35);
 this.poly([a,b,e,f],'#304252','#4d6676');c.fillStyle=busy?'#72d6b1':'#31566b';c.fillRect(a.x+20,a.y-18,23,16);c.fillStyle='#172b37';c.fillRect(a.x+22,a.y-16,19,11);}
 }
 const table=[point(7.4,6.7),point(10.4,6.7),point(10.4,7.4),point(7.4,7.4)];this.poly(table,'#3a5961','#77a6a5');
 this.hits=[];for(const [i,w] of this.workers.entries()){
 const d=DEPARTMENTS.find(d=>d.id===(w.role||w.id?.split('-')[0]));if(!d)continue;const r=room(d.id),unit=Number((w.worker_id||w.id||'').split('-').at(-1))||1;
 let p=point(r.x+1.6,r.y+2.5+((unit-1)%3)*1.35),moving=this.playing&&active?.worker===(w.worker_id||w.id);
 if(moving){const progress=((now-this.started)%1400)/1400,target=point(9,7),travel=Math.sin(progress*Math.PI)*.7;p={x:p.x+(target.x-p.x)*travel,y:p.y+(target.y-p.y)*travel};}
 const bob=moving?Math.sin(now/80)*3:Math.sin(now/1200+i)*.6;c.fillStyle='#0005';c.beginPath();c.ellipse(p.x,p.y+5,13,6,0,0,Math.PI*2);c.fill();c.fillStyle=d.color;c.fillRect(p.x-8,p.y-16+bob,16,19);c.fillStyle='#d5ac8d';c.beginPath();c.arc(p.x,p.y-24+bob,9,0,Math.PI*2);c.fill();c.fillStyle='#20283a';c.fillRect(p.x-9,p.y-31+bob,18,5);c.fillStyle='#132b38';c.fillRect(p.x-7,p.y+2,5,9);c.fillRect(p.x+2,p.y+2,5,9);
 this.hits.push({...p,worker:w});if(moving){const text=active.error?'งานไม่สำเร็จ: '+active.error:'ตรวจ '+active.tool+' แล้ว · '+active.status;c.fillStyle='#e9f5ef';c.fillRect(p.x-85,p.y-76,245,30);this.label(text,p.x-79,p.y-56,10,'#15332d');}
 }
 if(!this.workers.length)this.label('ยังไม่มี Worker ของบัญชีนี้ — ไม่มีบทสนทนาหรืองานที่สร้างขึ้นเพื่อแสดง',330,645,12,'#9cafbf');
 this.label('ภาพเคลื่อนไหวแยกจาก Trading Engine • ปิดหน้านี้ไม่หยุดระบบบน Cloud',280,674,11,'#7d9da8');
 }
}
