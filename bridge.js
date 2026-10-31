// Session credentials are kept in memory only, and sent exclusively to loopback.
export class LocalBridge {
  constructor(){this.base='http://127.0.0.1:7862';this.token='';}
  configure(raw){
    const parsed=new URL(raw,location.origin);if(parsed.origin!==location.origin)throw Error('استخدم رابط جلسة هذا الموقع من الإضافة.');
    const params=new URLSearchParams(parsed.hash.slice(1));const token=params.get('token')||params.get('session');
    const base=params.get('bridge')||'http://127.0.0.1:7862';
    if(base!=='http://127.0.0.1:7862')throw Error('عنوان الجسر المحلي غير مدعوم.');
    if(!token||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw Error('رابط الجلسة غير صالح أو لا يحتوي رمز الاتصال.');
    this.base=base;this.token=token;
  }
  async request(path,{method='GET',body,raw,contentType,blob=false,timeout=20000,idempotencyKey}={}){
    if(!this.token)throw Error('افتح الاستوديو من إضافة AIM لربط الجلسة.');
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(this.base+path,{method,headers:{'Authorization':'Bearer '+this.token,...(raw?{'Content-Type':contentType}:body?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:raw|| (body?JSON.stringify(body):undefined),credentials:'omit',redirect:'error',cache:'no-store',targetAddressSpace:'loopback',signal:controller.signal});
      if(response.status===401||response.status===403){this.token='';throw Error('انتهت جلسة الربط أو رُفضت. افتح الموقع مجدداً من إضافة AIM.');}
      if(!response.ok){let message='';try{const data=await response.json();message=typeof data.error==='string'?data.error:data.error?.message_ar||data.error?.message_en||'';}catch{}throw Error(message||`تعذر تنفيذ الطلب (${response.status}).`);}
      return blob?response.blob():response.json();
    }catch(e){if(e instanceof TypeError||e.name==='AbortError')throw Error('تعذر الوصول إلى المحرك المحلي. افتح SketchUp واربط الجلسة، وتحقق من سماح المتصفح بالوصول المحلي.');throw e;}finally{clearTimeout(timer);}
  }
  health(){return this.request('/v1/status');}
  upload(file){return this.request('/v1/images',{method:'POST',raw:file,contentType:file.type,timeout:60000});}
  start(payload){return this.request('/v1/jobs',{method:'POST',body:payload,timeout:60000,idempotencyKey:crypto.randomUUID()});}
  status(id){return this.request('/v1/jobs/'+encodeURIComponent(id));}
  cancel(id){return this.request('/v1/jobs/'+encodeURIComponent(id)+'/cancel',{method:'POST',body:{}});}
  model(id){return this.request('/v1/jobs/'+encodeURIComponent(id)+'/result.glb',{blob:true,timeout:120000});}
  import(id){return this.request('/v1/jobs/'+encodeURIComponent(id)+'/import',{method:'POST',body:{}});}
}
