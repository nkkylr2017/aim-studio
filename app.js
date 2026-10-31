import {LocalBridge} from './bridge.js';
const $=s=>document.querySelector(s);const bridge=new LocalBridge();
let imageFile=null,connected=false,busy=false,currentJob=null,currentBlob=null,stats=null,jobReport=null,pollTimer=null,previewURL=null,toastTimer=null,loadRevision=0,jobSettings=null,polling=false;
const storage={get(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}},set(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('تعذر حفظ الإعدادات في هذا المتصفح.');return false;}}};
function toast(message){$('#toast').textContent=String(message).slice(0,500);$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),6500);}
function updateControls(){
  $('#generate').disabled=busy||!connected||!imageFile;
  $('#generate-hint').textContent=busy?'المعالجة جارية في المحرك المنفصل.':!connected?'افتح الموقع من إضافة AIM لربط SketchUp.':!imageFile?'أضف صورة مرجعية للبدء.':'تُرسل الصورة إلى المحرك على هذا الجهاز فقط.';
  $('#import').disabled=busy||!connected||!currentJob||!currentBlob;
  $('#download').disabled=!currentBlob;$('#report').disabled=!stats;
  $('#connection-label').textContent=connected?'متصل بـ SketchUp':'ربط SketchUp';$('#connection-dot').classList.toggle('online',connected);
  $('#reset').disabled=busy;$('#cancel').disabled=!busy||!currentJob;
}
function settings(){
  const dims={};for(const key of ['width','depth','height']){const input=$('#'+key);if(input.value.trim()){const n=Number(input.value);if(!Number.isFinite(n)||n<1||n>2000)throw Error('أدخل مقاسات بين 1 و2000 سم، أو اترك المجهول فارغاً.');dims[key]=n;}}
  return {title:$('#project-name').value.trim()||'تصميم جديد',description:$('#description').value.trim(),select:$('#select-object').value.trim(),dimensions_cm:dims,quality:$('#quality').value,split_parts:$('#split').checked,processing:'local'};
}
function applySettings(value){$('#project-name').value=String(value.title||'').slice(0,80);$('#description').value=String(value.description||'').slice(0,2000);$('#select-object').value=String(value.select||'').slice(0,120);for(const k of ['width','depth','height'])$('#'+k).value=value.dimensions_cm?.[k]||'';$('#quality').value=['preview','standard','high'].includes(value.quality)?value.quality:'standard';$('#split').checked=value.split_parts!==false;}
async function chooseImage(file){
  if(busy)return toast('انتظر انتهاء المهمة أو ألغها أولاً.');
  if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type))return toast('اختر صورة PNG أو JPEG أو WebP.');
  if(file.size>15*1024*1024)return toast('حجم الصورة أكبر من 15 MB.');
  try{const bmp=await createImageBitmap(file);const width=bmp.width,height=bmp.height;bmp.close();if(width*height>40_000_000)throw Error('الصورة تتجاوز 40 مليون بكسل. استخدم نسخة أصغر.');
    imageFile=file;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(file);$('#reference-img').src=previewURL;$('#image-meta').textContent=`${width} × ${height} px · ${(file.size/1024/1024).toFixed(1)} MB · ${file.name}`;$('#image-preview').hidden=false;$('#dropzone').hidden=true;updateControls();
  }catch(e){toast(e.message||'تعذر قراءة الصورة.');}
}
function renderParts(parts){
  const list=$('#parts-list');list.replaceChildren();$('#part-count').textContent=parts.length;
  parts.forEach(part=>{const row=document.createElement('div');row.className='part-item';const label=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.checked=true;box.dataset.part=part.id;box.addEventListener('change',()=>window.AIMViewer.visible(part.id,box.checked));const name=document.createElement('span');name.textContent=part.name;name.title=part.name;label.append(box,name);const isolate=document.createElement('button');isolate.textContent='عزل';isolate.setAttribute('aria-label','عزل '+part.name);isolate.onclick=()=>{window.AIMViewer.isolate(part.id);list.querySelectorAll('input').forEach(input=>input.checked=Number(input.dataset.part)===part.id);};row.append(label,isolate);list.append(row);});
  $('#parts-hint').textContent='الأسماء تأتي من الملف. كل صف يمثل سطحاً أو جزءاً موجوداً فيه، وليس تعرفاً آلياً مؤكداً.';$('#explode-control').hidden=false;$('#explode').value=0;
}
async function openModel(blob,fromJob=false){
  if(blob.size>100*1024*1024)throw Error('المجسم أكبر من حد المعاينة 100 MB.');
  const revision=++loadRevision;const next=await window.AIMViewer.load(await blob.arrayBuffer());if(revision!==loadRevision)return;
  currentBlob=blob;stats=next;if(!fromJob){currentJob=null;jobReport=null;}
  $('#empty-view').hidden=true;$('#mesh-stats').textContent=`${next.triangles.toLocaleString('ar')} مثلث · ${next.parts.length} جزء في الملف`;
  renderParts(next.parts);updateControls();
}
async function connect(raw){
  try{bridge.configure(raw);$('#session-link').value='';$('#connect-message').textContent='جارٍ الاتصال…';const health=await bridge.health();if(health.protocol!=='aim-bridge/1')throw Error('إصدار الجسر غير متوافق. حدّث إضافة AIM.');connected=true;$('#connect-message').textContent='تم الربط بالمحرك المحلي.';$('#connect-dialog').close();toast(health.sketchup?.connected?'تم ربط الاستوديو بالجهاز.':'الجسر متصل. افتح SketchUp لبدء المعالجة.');updateControls();return health;}catch(e){connected=false;$('#connect-message').textContent=e.message;updateControls();toast(e.message);}
}
function base64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('تعذرت قراءة الصورة.'));reader.readAsDataURL(file);});}
async function start(){
  if(busy||!connected||!imageFile)return;
  try{const config=settings();jobSettings=config;busy=true;currentJob=null;currentBlob=null;stats=null;jobReport=null;window.AIMViewer.clear();$('#empty-view').hidden=false;$('#parts-list').replaceChildren();$('#part-count').textContent='0';$('#explode-control').hidden=true;$('#job-progress').hidden=false;$('#job-stage').textContent='تجهيز الصورة…';$('#progress').value=0;$('#job-detail').textContent='نقل الصورة إلى المحرك المحلي.';updateControls();
    const health=await bridge.health();if(!health.sketchup?.connected)throw Error('افتح SketchUp على هذا الجهاز قبل بدء المهمة.');
    if(health.processing?.enforced_local!==true)throw Error('يلزم تحديث جسر AIM ليفرض المعالجة المحلية لكل مهمة. إعداد الخصوصية العام وحده لا يكفي؛ لم تُرسل الصورة.');
    const uploaded=await bridge.upload(imageFile);if(!uploaded.image_id)throw Error('تعذر تسجيل الصورة لدى المحرك.');
    const payload={image_id:uploaded.image_id,select:config.select,description:config.description,dims_cm:config.dimensions_cm,quality:config.quality,split_parts:config.split_parts};
    const result=await bridge.start(payload);if(!result.job_id)throw Error('المحرك لم يرجع رقم مهمة صالحاً.');currentJob=String(result.job_id);saveProject(config,'processing');updateControls();poll();
  }catch(e){busy=false;$('#job-stage').textContent='لم تبدأ المهمة';$('#job-detail').textContent=e.message;toast(e.message);updateControls();}
}
async function poll(){
  if(!currentJob||!busy||polling)return;polling=true;
  try{const status=await bridge.status(currentJob);jobReport=status;
    $('#job-stage').textContent=status.stage||'المعالجة جارية';const p=status.stage_fraction;$('#progress').value=Number.isFinite(p)?Math.max(0,Math.min(100,p*100)):0;
    $('#job-detail').textContent=status.message_ar||'الحسابات في عملية مستقلة عن واجهة SketchUp.';
    if(status.state==='succeeded'){
      $('#job-stage').textContent='تحميل المجسم للمعاينة…';await openModel(await bridge.model(currentJob),true);busy=false;$('#progress').value=100;$('#job-stage').textContent='المجسم جاهز للمراجعة';$('#job-detail').textContent=status.data_left_pc?'المحرك أبلغ بإرسال الصورة خارج الجهاز؛ راجع إعدادات الخصوصية.':'افحص الأجزاء والمقاسات، ثم أرسله إلى SketchUp.';saveProject(jobSettings,'completed');toast('اكتمل المجسم. راجعه قبل الاستيراد.');updateControls();return;
    }
    if(['failed','cancelled'].includes(status.state)){busy=false;$('#job-stage').textContent=status.state==='cancelled'?'أُلغيت المهمة':'تعذرت المعالجة';$('#job-detail').textContent=status.error?.message_ar||status.message_ar||'لم تُنتج المهمة مجسماً.';updateControls();return;}
    pollTimer=setTimeout(poll,1500);
  }catch(e){busy=false;connected=false;$('#job-stage').textContent='انقطع الاتصال';$('#job-detail').textContent=e.message+' قد تستمر المهمة في المحرك؛ تحقق منها في SketchUp.';toast(e.message);updateControls();}finally{polling=false;}
}
function saveProject(config,status){const records=storage.get('aim.projects',[]);const id=currentJob||crypto.randomUUID();const item={...config,id,status,time:new Date().toISOString()};storage.set('aim.projects',[item,...records.filter(x=>x.id!==id)].slice(0,30));}
function projects(){const list=$('#project-list');list.replaceChildren();const records=storage.get('aim.projects',[]);if(!records.length){const empty=document.createElement('p');empty.className='empty-projects';empty.textContent='لا توجد مشاريع محفوظة بعد. ابدأ بصورة أو احفظ إعداداتك من الاستوديو.';list.append(empty);}records.forEach(record=>{const card=document.createElement('article');card.className='project-card';const title=document.createElement('h3');title.textContent=record.title;const date=document.createElement('p');date.textContent=new Date(record.time).toLocaleString('ar-SA');const desc=document.createElement('p');desc.textContent=record.description||'إعدادات تصميم محفوظة';const button=document.createElement('button');button.className='secondary';button.textContent='استخدام الإعدادات';button.onclick=()=>{if(busy)return toast('توجد مهمة جارية.');applySettings(record);showStudio();toast('حُمّلت الإعدادات. أضف الصورة المرجعية.');};card.append(title,date,desc,button);list.append(card);});$('#studio').hidden=true;$('#projects').hidden=false;$('#history-tab').classList.add('active');$('#studio-tab').classList.remove('active');}
function showStudio(){$('#studio').hidden=false;$('#projects').hidden=true;$('#studio-tab').classList.add('active');$('#history-tab').classList.remove('active');}
$('#connect').onclick=()=>$('#connect-dialog').showModal();$('#connect-link').onclick=()=>connect($('#session-link').value.trim());
$('#guide-tab').onclick=$('#help').onclick=()=>$('#guide-dialog').showModal();$('#history-tab').onclick=projects;$('#studio-tab').onclick=$('#back-studio').onclick=showStudio;
$('#image-file').onchange=e=>chooseImage(e.target.files[0]);$('#replace-image').onclick=()=>$('#image-file').click();
for(const event of ['dragenter','dragover'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.add('dragover');});for(const event of ['dragleave','drop'])$('#dropzone').addEventListener(event,e=>{e.preventDefault();$('#dropzone').classList.remove('dragover');if(event==='drop')chooseImage(e.dataTransfer.files[0]);});
$('#generate').onclick=start;$('#cancel').onclick=async()=>{if(!currentJob)return;try{await bridge.cancel(currentJob);$('#job-stage').textContent='طلب الإلغاء أُرسل…';}catch(e){toast(e.message);}};
$('#model-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(busy)return toast('انتظر انتهاء المهمة أولاً.');try{await openModel(file);toast('فُتح الملف محلياً في المتصفح.');}catch(error){toast(error.message);}};
$('#solid').onclick=()=>setWire(false);$('#wireframe').onclick=()=>setWire(true);function setWire(value){window.AIMViewer.setWire(value);$('#solid').classList.toggle('selected',!value);$('#wireframe').classList.toggle('selected',value);$('#solid').setAttribute('aria-pressed',!value);$('#wireframe').setAttribute('aria-pressed',value);}
$('#fit').onclick=()=>window.AIMViewer.fit();$('#rotate').onclick=()=>{const value=$('#rotate').getAttribute('aria-pressed')!=='true';$('#rotate').setAttribute('aria-pressed',value);window.AIMViewer.rotate(value);};$('#explode').oninput=e=>window.AIMViewer.explode(Number(e.target.value)/100);$('#show-all').onclick=()=>{window.AIMViewer.showAll();$('#parts-list').querySelectorAll('input').forEach(i=>i.checked=true);};
$('#download').onclick=()=>{if(!currentBlob)return;const url=URL.createObjectURL(currentBlob);const a=document.createElement('a');a.href=url;a.download=($('#project-name').value.trim()||'aim-model').replace(/[<>:"/\\|?*]/g,'_')+'.glb';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
$('#import').onclick=async()=>{if(!currentJob)return;$('#import').disabled=true;try{const result=await bridge.import(currentJob);toast(result.message||'أُرسل طلب الاستيراد إلى SketchUp.');}catch(e){toast(e.message);}finally{updateControls();}};
$('#report').onclick=()=>{$('#report-text').textContent=JSON.stringify({processing:'local',geometry:stats,engine:jobReport,limitations:['الجوانب المخفية تقديرية','الأجزاء المعروضة من بنية الملف، وليست دليلاً على التعرف الدلالي','المقاسات في المعاينة تعتمد على وحدات ملف GLB']},null,2);$('#report-dialog').showModal();};
$('#save-preset').onclick=()=>{try{const config=settings();if(storage.set('aim.preset',config)){saveProject(config,'settings');$('#load-preset').hidden=false;toast('حُفظت إعداداتك في هذا المتصفح دون الصور.');}}catch(e){toast(e.message);}};$('#load-preset').onclick=()=>{if(busy)return toast('توجد مهمة جارية.');const p=storage.get('aim.preset',null);if(p){applySettings(p);toast('استُخدمت إعداداتك المحفوظة سابقاً. راجعها لهذا المرجع.');}};$('#load-preset').hidden=!storage.get('aim.preset',null);
$('#reset').onclick=()=>{if(busy)return;imageFile=null;currentJob=null;currentBlob=null;stats=null;jobReport=null;loadRevision++;window.AIMViewer.clear();$('#image-preview').hidden=true;$('#dropzone').hidden=false;$('#empty-view').hidden=false;$('#job-progress').hidden=true;$('#image-file').value='';$('#model-file').value='';$('#parts-list').replaceChildren();$('#part-count').textContent='0';$('#explode-control').hidden=true;$('#mesh-stats').textContent='لا يوجد مجسم بعد';applySettings({});updateControls();};
function consumeLaunch(){if(!location.hash)return;const launch=location.href;history.replaceState(null,'',location.pathname+location.search);connect(launch);}
window.addEventListener('hashchange',consumeLaunch);consumeLaunch();updateControls();
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&busy){clearTimeout(pollTimer);poll();}});
