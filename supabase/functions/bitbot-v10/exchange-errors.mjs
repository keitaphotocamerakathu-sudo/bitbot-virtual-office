// Public error metadata only; never return response bodies or credentials.
export function exchangeFailure(httpStatus,body){
 const raw=String(body?.error??body?.code??''),exchangeCode=/^[A-Z0-9-]{1,24}$/.test(raw)?raw:null;
 const known={
  '3':['BITKUB_INVALID_API_KEY','API Key ที่บันทึกไว้ไม่ถูกต้อง กรุณาเชื่อม API Key/Secret ใหม่ที่หน้า Live Trading','RECONNECT_BITKUB'],
  'A1003-MK':['BITKUB_INVALID_API_KEY','API Key ที่บันทึกไว้ไม่ถูกต้อง กรุณาเชื่อม API Key/Secret ใหม่ที่หน้า Live Trading','RECONNECT_BITKUB'],
  '4':['BITKUB_KEY_NOT_ACTIVE','API Key ยังไม่เปิดใช้งาน กรุณาตรวจสถานะที่ Bitkub','CHECK_KEY_ACTIVATION'],
  '5':['BITKUB_IP_NOT_ALLOWED','Bitkub ไม่อนุญาต IP ของ Backend กรุณาตรวจ IP Allowlist ของ API Key','CHECK_IP_ALLOWLIST'],
  '6':['BITKUB_INVALID_SIGNATURE','Bitkub ตรวจลายเซ็นไม่ผ่าน กรุณาตรวจ API Secret และการเชื่อมต่อ','CHECK_API_SECRET'],
  '52':['BITKUB_PERMISSION_DENIED','API Key ไม่มีสิทธิ์สำหรับคำขอนี้ กรุณาตรวจสิทธิ์ที่ Bitkub','CHECK_KEY_PERMISSIONS']
 }[exchangeCode];
 if(known)return Object.assign(Error('Bitkub (รหัส '+exchangeCode+'): '+known[1]),{status:409,code:known[0],action:known[2],retryable:false,exchangeStatus:httpStatus,exchangeCode,exchangeRejected:true});
 if(httpStatus===429)return Object.assign(Error('Bitkub จำกัดคำขอ (429) ระบบจะพักก่อนตรวจใหม่'),{status:429,code:'BITKUB_RATE_LIMIT',action:'WAIT_AND_RECHECK',retryable:true,exchangeStatus:httpStatus,exchangeCode,exchangeRejected:false});
 if(httpStatus===401||httpStatus===403)return Object.assign(Error('Bitkub ไม่อนุญาตการเชื่อมต่อบัญชี (HTTP '+httpStatus+') กรุณาตรวจ API Key/Secret'),{status:409,code:'BITKUB_AUTH_REJECTED',action:'RECONNECT_BITKUB',retryable:false,exchangeStatus:httpStatus,exchangeCode,exchangeRejected:true});
 const rejected=httpStatus<500&&!!exchangeCode&&exchangeCode!=='0';
 return Object.assign(Error('Bitkub '+(rejected?'ปฏิเสธคำขอ':'ยังให้บริการไม่สำเร็จ')+(exchangeCode?' (รหัส '+exchangeCode+')':'')),{status:rejected?409:502,code:rejected?'BITKUB_REQUEST_REJECTED':'BITKUB_UPSTREAM_UNAVAILABLE',action:rejected?'CHECK_ACCOUNT':'RECHECK_STATUS',retryable:!rejected,exchangeStatus:httpStatus,exchangeCode,exchangeRejected:rejected});
}
