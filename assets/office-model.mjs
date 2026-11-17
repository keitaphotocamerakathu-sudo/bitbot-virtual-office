// Visual simulation only. Paths and dialogue never execute a trading tool.
import {DEPARTMENTS} from './company.mjs?v=14.0.0';
export const OFFICE_NAMES={ceo:'ผู้จัดการ',cio:'วางแผน',market:'ตลาด',news:'ข่าว',quant:'วิจัย',portfolio:'จัดพอร์ต',risk:'ความเสี่ยง',execution:'ส่งคำสั่ง',audit:'ตรวจสอบ',learning:'เรียนรู้'};
export const workerId=w=>w.worker_id||w.id;
export const workerRole=w=>w.role||workerId(w)?.split('-')[0];
export const tileKey=(x,y)=>x+','+y;
export function createOfficeLayout(){
 const layout={width:30,height:22,blocked:new Set(),rooms:[]},block=(x,y,w=1,h=1)=>{for(let a=x;a<x+w;a++)for(let b=y;b<y+h;b++)layout.blocked.add(tileKey(a,b));};
 DEPARTMENTS.forEach((d,i)=>{const x=i%5*6,y=i<5?0:14,door={x:x+3,y:i<5?7:14};
  block(x,y,6,1);block(x,y+7,6,1);block(x,y,1,8);block(x+5,y,1,8);layout.blocked.delete(tileKey(door.x,door.y));
  block(x+1,y+2,2,1);block(x+1,y+5,2,1);
  block(x+4,y+1,1,2);block(x+4,y+6);
  layout.rooms.push({...d,x,y,w:6,h:8,door,homes:[{x:x+1.5,y:y+3.5},{x:x+1.5,y:y+6.5},{x:x+3.5,y:y+3.5}]});
 });
 block(13,10,5,2);block(2,9,4,1);block(24,9,4,1);block(25,12,3,1);block(1,11);block(28,9);
 layout.breakSpots=[{x:3.5,y:11.5},{x:25.5,y:11.5},{x:12.5,y:10.5},{x:18.5,y:11.5}];
 return layout;
}
export const walkable=(l,x,y)=>x>=0&&x<l.width&&y>=0&&y<l.height&&!l.blocked.has(tileKey(x,y));
export function findPath(l,from,to){
 const sx=Math.floor(from.x),sy=Math.floor(from.y),tx=Math.floor(to.x),ty=Math.floor(to.y);
 if(!walkable(l,sx,sy)||!walkable(l,tx,ty))return[];
 const first=tileKey(sx,sy),last=tileKey(tx,ty),queue=[[sx,sy]],parents=new Map([[first,null]]);
 for(let i=0;i<queue.length;i++){const [x,y]=queue[i],key=tileKey(x,y);if(key===last)break;
  for(const [a,b] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){const k=tileKey(a,b);if(walkable(l,a,b)&&!parents.has(k)){parents.set(k,key);queue.push([a,b]);}}
 }
 if(!parents.has(last))return[];const out=[];for(let k=last;k!==null;k=parents.get(k)){const [x,y]=k.split(',').map(Number);out.unshift({x:x+.5,y:y+.5});}return out;
}
export function visitPoint(l,target,from){
 const x=Math.floor(target.x),y=Math.floor(target.y),points=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]].filter(([a,b])=>walkable(l,a,b)).map(([a,b])=>({x:a+.5,y:b+.5}));
 return points.sort((a,b)=>Math.abs(a.x-from.x)+Math.abs(a.y-from.y)-Math.abs(b.x-from.x)-Math.abs(b.y-from.y))[0]||target;
}
const first=o=>Object.entries(o||{})[0];
const value=(n,d=1)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(d):'ไม่พร้อม';
export function describeOfficeTask(task){
 if(!task)return'รอผลที่บันทึกไว้';if(task.status==='FAILED')return'งานไม่สำเร็จ: '+String(task.error||task.output?.error||'ตรวจรายละเอียดงาน');
 if(task.source==='REA_BACKEND'&&typeof task.summary==='string')return task.summary.slice(0,600);
 const o=task.output||{};
 switch(task.role){
 case'ceo':return'รอบนี้คัดกรอง '+(o.universe??'—')+' คู่ • '+(o.mode||'รอข้อมูล');
 case'cio':{const p=first(o)?.[1];return p?'ใช้แผน '+p.strategy+' • ทุนสูงสุด '+value(p.budget,0)+' บาท':'ส่งกรอบแผนและวงเงินตามเจ้าของตั้งไว้';}
 case'market':{const [symbol,frames]=first(o)||[],h=frames?.['60'];return symbol?symbol+' • 1 ชั่วโมง '+(h?.ready?h.regime:'ข้อมูลยังไม่ครบ')+' • RSI '+value(frames?.['5']?.rsi):'รอข้อมูลตลาดที่ตรวจสอบได้';}
 case'news':{const n=first(o)?.[1];return n?(n.blocked?'งดซื้อใหม่: ':'')+(n.reason||'ตรวจสถานะข่าวแล้ว'):'รอข่าวที่เกี่ยวข้อง';}
 case'quant':{const p=first(o.signals)?.[1];return p?(p.signal||'HOLD')+' • '+(p.reason||p.strategy||'ตามผลกลยุทธ์'):'รอผลประเมินกลยุทธ์';}
 case'portfolio':{const p=first(o)?.[1];return p?'ซื้อได้สูงสุดตามเงื่อนไข '+value(p.maxBuy,2)+' บาท • สำรอง '+value(p.reserve,2)+' บาท':'ยังไม่มีข้อมูลวงเงินพร้อมประเมิน';}
 case'risk':{const r=first(o)?.[1];return r?(r.action||'HOLD')+' • '+((r.companyVeto||[]).join(' • ')||r.blocked?.join(' • ')||'ผลตรวจตามวงเงินและความเสี่ยง'):'รอผลตรวจความเสี่ยง';}
 case'execution':{const p=first(o)?.[1];return p?.order?'แผน '+p.order.side+' '+p.order.symbol+' • ยังไม่ถือว่าจับคู่แล้ว':'รอบนี้ไม่มีคำสั่งซื้อขายส่งออก';}
 case'audit':{const p=first(o)?.[1];return p?(p.consistent?'ตรวจสมการเงินตรงกัน':'พบยอดไม่ตรง ต้องตรวจสอบ')+' • เงินสด '+value(p.cash,2)+' บาท':'รอหลักฐานบัญชี';}
 case'learning':{const p=first(o)?.[1];return p?'มีผลปิดรอบ '+(p.closedRounds||0)+' รอบ • ไม่เปลี่ยนกติกาอัตโนมัติ':'รอผลปิดรอบสำหรับประเมิน';}
 default:return String(task.tool||'งาน')+' • '+task.status;
 }
}
export function officeHandoffs(archive,workers){
 const ids=new Set(workers.map(workerId));return(archive?.messages||[]).flatMap(m=>{
 const task=archive.tasks?.find(t=>t.id===m.taskId&&t.worker===m.from),reply=archive.tasks?.find(t=>t.worker===m.to);
 if(!task||!ids.has(m.from)||!ids.has(m.to))return[];
 return[{...m,summary:describeOfficeTask(task),reply:reply?describeOfficeTask(reply):null,replyTaskId:reply?.id,sourceAt:task.source==='REA_BACKEND'?task.finishedAt:archive.finishedAt,mode:archive.mode,taskStatus:task.status}];
 });
}
