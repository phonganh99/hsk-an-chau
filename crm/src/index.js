
const SITE_ORIGIN = "https://hsk.anchaugroup.com.vn";
const STATUSES = new Set(["new","contacted","invited","deposit","enrolled","lost"]);
const COURSES = new Set(["hsk1","hsk2","hsk3","combo","unsure"]);
const OFFICES = new Set(["hn","na"]);
const SLOTS = new Set(["","AC1","AC2","AC3","AC4"]);
const LEVELS = new Set(["","new","studied","unsure"]);
const SOURCE_TYPES = new Set(["direct","marketing","partner","staff"]);

function reply(body,status=200,extra={}) {
  return new Response(JSON.stringify(body),{
    status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff","referrer-policy":"no-referrer",...extra}
  });
}
function headersForOrigin(req) {
  return req.headers.get("origin")===SITE_ORIGIN?{
    "access-control-allow-origin":SITE_ORIGIN,
    "access-control-allow-methods":"POST,GET,PATCH,OPTIONS",
    "access-control-allow-headers":"Content-Type,Authorization",
    "access-control-max-age":"600",
    "vary":"Origin"
  }:{};
}
function normalizePhone(value) {
  const raw=String(value||"").trim().replace(/[\s.()-]/g,"");
  let digits=raw;
  if(digits.startsWith("+84"))digits="0"+digits.slice(3);
  else if(digits.startsWith("84")&&digits.length===11)digits="0"+digits.slice(2);
  return /^0[35789][0-9]{8}$/.test(digits)?digits:null;
}
function cleanText(value,maxLength=90) {
  if(typeof value!=="string")return "";
  return value.replace(/[\u0000-\u001F\u007F]/g,"").trim().slice(0,maxLength);
}
async function readJson(req) {
  const size=Number(req.headers.get("content-length")||"0");
  if(size>12000)throw new Error("body_too_large");
  const raw=await req.text();
  if(raw.length>12000)throw new Error("body_too_large");
  return JSON.parse(raw);
}
function csvCell(value){
  let str=String(value??"").replace(/[\r\n\t]+/g," ");
  if(/^[=+@-]/.test(str.trim()))str="'"+str;
  return '"'+str.replace(/"/g,'""')+'"';
}
async function tokenEqual(provided,expected) {
  if(!expected||expected.length<32||!provided)return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest("SHA-256",encoder.encode(provided)),
    crypto.subtle.digest("SHA-256",encoder.encode(expected))
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
  return diff===0;
}
async function isAdmin(req,env) {
  const header=req.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))return false;
  return tokenEqual(header.slice(7),env.ADMIN_TOKEN);
}
async function verifyTurnstile(token,env){
  if(!env.TURNSTILE_SECRET||typeof token!=="string"||token.length<10||token.length>2048)return false;
  const challenge=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token})
  });
  if(!challenge.ok)return false;
  const result=await challenge.json();
  return result.success===true&&result.hostname==="hsk.anchaugroup.com.vn"&&result.action==="hsk_registration";
}
async function postLead(req,env,ctx){
  if(req.headers.get("origin")!==SITE_ORIGIN)return reply({error:"origin_not_allowed"},403,headersForOrigin(req));
  if(!env.TURNSTILE_SECRET||!env.DB)return reply({error:"registration_not_ready"},503,headersForOrigin(req));
  let input;
  try{input=await readJson(req)}catch{return reply({error:"invalid_request"},400,headersForOrigin(req));}
  // Honeypot: legitimate users leave this field empty.
  if(input.company_website)return reply({error:"invalid_request"},400,headersForOrigin(req));
  const name=cleanText(input.full_name,90);
  const phone=normalizePhone(input.phone);
  const office=String(input.office||"");
  const course=String(input.course||"");
  const preferred=String(input.preferred_slot||"");
  const level=String(input.previous_level||"");
  const policyVersion=cleanText(input.privacy_notice_version,40);
  if(name.length<2||!phone||!OFFICES.has(office)||!COURSES.has(course)||!SLOTS.has(preferred)||!LEVELS.has(level)||policyVersion!=="hsk-privacy-v1"){
    return reply({error:"invalid_fields"},422,headersForOrigin(req));
  }
  let verified=false;
  try{verified=await verifyTurnstile(input.turnstile_token,env)}catch{verified=false;}
  if(!verified)return reply({error:"verification_failed"},422,headersForOrigin(req));
  const proposedCode=cleanText(input.source_code||"direct",48).toLowerCase();
  const sourceRow=/^[a-z0-9_-]{1,48}$/.test(proposedCode)?
    await env.DB.prepare("SELECT code FROM lead_sources WHERE code=? AND is_active=1").bind(proposedCode).first():null;
  const source=sourceRow?sourceRow.code:"direct";
  const now=new Date().toISOString();
  const contactId=crypto.randomUUID(),oppId=crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO contacts(id,full_name,phone,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(contactId,name,phone,now,now).run();
  const contact=await env.DB.prepare("SELECT id FROM contacts WHERE phone=?").bind(phone).first();
  if(!contact)return reply({error:"storage_failed"},503,headersForOrigin(req));
  await env.DB.prepare("INSERT OR IGNORE INTO opportunities(id,contact_id,program,course,office,preferred_slot,previous_level,status,first_source_code,last_source_code,privacy_notice_version,created_at,updated_at) VALUES(?,?,'HSK',?,?,?,?,'new',?,?,?,?,?)")
    .bind(oppId,contact.id,course,office,preferred,level,source,source,policyVersion,now,now).run();
  const lead=await env.DB.prepare("SELECT id,created_at FROM opportunities WHERE contact_id=? AND program='HSK'").bind(contact.id).first();
  if(!lead)return reply({error:"storage_failed"},503,headersForOrigin(req));
  // A repeated enquiry updates current interest only, never resets status/owner/first_source_code.
  await env.DB.prepare("UPDATE opportunities SET course=?,office=?,preferred_slot=?,previous_level=?,last_source_code=?,updated_at=? WHERE id=?")
    .bind(course,office,preferred,level,source,now,lead.id).run();
  await env.DB.prepare("INSERT INTO lead_events(id,opportunity_id,event_type,source_code,details,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),lead.id,lead.id===oppId?"created":"re_submitted",source,"",now).run();
  if(lead.id===oppId){await queueNewLeadNotification(env,lead.id,now);scheduleNotification(ctx,env);}
  return reply({ok:true,lead_code:lead.id,received:true},201,headersForOrigin(req));
}

async function queueNewLeadNotification(env,leadId,now) {
  await env.DB.prepare("INSERT OR IGNORE INTO notification_outbox(id,opportunity_id,channel,event_type,status,created_at,updated_at) VALUES(?,?,'telegram','new_lead','pending',?,?)")
    .bind(crypto.randomUUID(),leadId,now,now).run();
}
function telegramConfigured(env) {
  return typeof env.TELEGRAM_BOT_TOKEN==="string"&&env.TELEGRAM_BOT_TOKEN.length>=25&&
    typeof env.TELEGRAM_CHAT_ID==="string"&&env.TELEGRAM_CHAT_ID.trim().length>0;
}
function scheduleNotification(ctx,env) {
  if(ctx&&typeof ctx.waitUntil==="function"&&telegramConfigured(env))ctx.waitUntil(flushTelegramOutbox(env,5).catch(()=>{}));
}
async function flushTelegramOutbox(env,limit=10) {
  if(!telegramConfigured(env))return {configured:false,sent:0,failed:0};
  const pending=await env.DB.prepare("SELECT n.id,n.opportunity_id,o.course,o.office,o.first_source_code,o.created_at FROM notification_outbox n JOIN opportunities o ON o.id=n.opportunity_id WHERE n.channel='telegram' AND n.event_type='new_lead' AND n.status='pending' AND n.attempts<10 ORDER BY n.created_at ASC LIMIT ?").bind(limit).all();
  let sent=0,failed=0;
  for(const n of pending.results||[]){
    const locked=await env.DB.prepare("UPDATE notification_outbox SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'").bind(new Date().toISOString(),n.id).run();
    if((locked.meta?.changes||0)!==1)continue;
    const officeName=n.office==='hn'?'Hà Nội':'Nghệ An';
    const courseName={hsk1:'HSK 1',hsk2:'HSK 2',hsk3:'HSK 3',combo:'Combo 1–3',unsure:'Cần tư vấn'}[n.course]||'HSK';
    // Group notifications do not include learner's name, phone number, or private notes.
    const msg=['🔔 AN CHÂU · LEAD HSK MỚI','Mã: '+n.opportunity_id.slice(0,8),'Cơ sở: '+officeName,'Khóa: '+courseName,'Nguồn: '+n.first_source_code,'Mở CRM: https://hsk.anchaugroup.com.vn/crm/admin/'].join('\n');
    let delivered=false;
    try {
      const res=await fetch('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/sendMessage',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,text:msg,disable_web_page_preview:true})
      });
      if(res.ok){const data=await res.json();delivered=data.ok===true;}
    } catch {delivered=false;}
    if(delivered){
      await env.DB.prepare("UPDATE notification_outbox SET status='sent',last_error='',updated_at=? WHERE id=?").bind(new Date().toISOString(),n.id).run();
      sent++;
    } else {
      await env.DB.prepare("UPDATE notification_outbox SET status='pending',last_error='telegram_delivery_failed',updated_at=? WHERE id=?").bind(new Date().toISOString(),n.id).run();
      failed++;
    }
  }
  return {configured:true,sent,failed};
}
async function adminCreateLead(req,env,ctx) {
  let data;try{data=await readJson(req);}catch{return reply({error:'invalid_request'},400);}
  const name=cleanText(data.full_name,90),phone=normalizePhone(data.phone);
  const office=String(data.office||''),course=String(data.course||'');
  const preferred=String(data.preferred_slot||''),level=String(data.previous_level||'');
  const source=cleanText(data.source_code||'',48).toLowerCase();
  const assigned=cleanText(data.assigned_to||'',80),enteredBy=cleanText(data.entered_by||'',80);
  if(!phone||name.length<2||!OFFICES.has(office)||!COURSES.has(course)||!SLOTS.has(preferred)||!LEVELS.has(level)||
     !/^[a-z0-9_-]{3,48}$/.test(source)||enteredBy.length<2||data.privacy_confirmed!==true)
    return reply({error:'invalid_fields'},422);
  const validSource=await env.DB.prepare("SELECT code FROM lead_sources WHERE code=? AND is_active=1").bind(source).first();
  if(!validSource)return reply({error:'invalid_source'},422);
  const now=new Date().toISOString(),contactId=crypto.randomUUID(),oppId=crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO contacts(id,full_name,phone,created_at,updated_at) VALUES(?,?,?,?,?)")
    .bind(contactId,name,phone,now,now).run();
  const contact=await env.DB.prepare("SELECT id FROM contacts WHERE phone=?").bind(phone).first();
  if(!contact)return reply({error:'storage_failed'},503);
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO opportunities(id,contact_id,program,course,office,preferred_slot,previous_level,status,assigned_to,first_source_code,last_source_code,privacy_notice_version,created_at,updated_at) VALUES(?,?,'HSK',?,?,?,?,'new',?,?,?,'manual-hsk-v1',?,?)")
    .bind(oppId,contact.id,course,office,preferred,level,assigned,source,source,now,now).run();
  const created=(inserted.meta?.changes||0)>0;
  const lead=await env.DB.prepare("SELECT id,created_at FROM opportunities WHERE contact_id=? AND program='HSK'").bind(contact.id).first();
  if(!lead)return reply({error:'storage_failed'},503);
  // Audit the staff-supplied name; until personal login is added this is NOT verified identity.
  await env.DB.prepare("INSERT INTO lead_events(id,opportunity_id,event_type,source_code,details,created_at) VALUES(?,?,?,?,?,?)")
    .bind(crypto.randomUUID(),lead.id,created?'manual_created':'manual_duplicate',source,JSON.stringify({entered_by:enteredBy}),now).run();
  if(created){await queueNewLeadNotification(env,lead.id,now);scheduleNotification(ctx,env);}
  return reply({ok:true,lead_code:lead.id,created,duplicate:!created,notification_queued:created},created?201:200);
}

async function adminLeads(url,env) {
  const office=url.searchParams.get("office")||"";
  const status=url.searchParams.get("status")||"";
  if((office&&!OFFICES.has(office))||(status&&!STATUSES.has(status)))return reply({error:"invalid_filter"},400);
  const limit=Math.min(Math.max(parseInt(url.searchParams.get("limit")||"100",10)||100,1),200);
  const offset=Math.min(Math.max(parseInt(url.searchParams.get("offset")||"0",10)||0,0),100000);
  let query="SELECT o.id,o.program,o.course,o.office,o.preferred_slot,o.previous_level,o.status,o.assigned_to,o.first_source_code,o.last_source_code,o.privacy_notice_version,o.created_at,o.updated_at,c.full_name,c.phone FROM opportunities o JOIN contacts c ON o.contact_id=c.id WHERE 1=1";
  const args=[];
  if(office){query+=" AND o.office=?";args.push(office);}
  if(status){query+=" AND o.status=?";args.push(status);}
  query+=" ORDER BY o.created_at DESC LIMIT ? OFFSET ?";args.push(limit,offset);
  const rows=await env.DB.prepare(query).bind(...args).all();
  return reply({ok:true,items:rows.results||[],limit,offset});
}
async function adminStats(env){
  const total=await env.DB.prepare("SELECT COUNT(*) AS count FROM opportunities").first();
  const grouped=await env.DB.prepare("SELECT status,COUNT(*) AS count FROM opportunities GROUP BY status").all();
  const byOffice=await env.DB.prepare("SELECT office,COUNT(*) AS count FROM opportunities GROUP BY office").all();
  return reply({ok:true,total:total?.count||0,by_status:grouped.results||[],by_office:byOffice.results||[]});
}
async function adminUpdate(req,env,id){
  let data;
  try{data=await readJson(req)}catch{return reply({error:"invalid_request"},400)}
  const status=String(data.status||"");
  const owner=cleanText(data.assigned_to||"",80);
  const changeStatus=data.status!==undefined;
  const changeOwner=data.assigned_to!==undefined;
  if(!changeStatus&&!changeOwner)return reply({error:"nothing_to_update"},400);
  if(changeStatus&&!STATUSES.has(status))return reply({error:"invalid_status"},422);
  const current=await env.DB.prepare("SELECT id,status,assigned_to FROM opportunities WHERE id=?").bind(id).first();
  if(!current)return reply({error:"not_found"},404);
  const nextStatus=changeStatus?status:current.status;
  const nextOwner=changeOwner?owner:current.assigned_to;
  const now=new Date().toISOString();
  await env.DB.prepare("UPDATE opportunities SET status=?,assigned_to=?,updated_at=? WHERE id=?").bind(nextStatus,nextOwner,now,id).run();
  const details=JSON.stringify({from_status:current.status,to_status:nextStatus,from_owner:current.assigned_to,to_owner:nextOwner});
  await env.DB.prepare("INSERT INTO lead_events(id,opportunity_id,event_type,details,created_at) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(),id,"admin_update",details,now).run();
  return reply({ok:true,id,status:nextStatus,assigned_to:nextOwner});
}
async function adminExport(env){
  const result=await env.DB.prepare("SELECT o.id,o.program,o.course,o.office,o.preferred_slot,o.previous_level,o.status,o.assigned_to,o.first_source_code,o.last_source_code,o.created_at,o.updated_at,c.full_name,c.phone FROM opportunities o JOIN contacts c ON c.id=o.contact_id ORDER BY o.created_at ASC LIMIT 20000").all();
  const columns=["id","full_name","phone","program","course","office","preferred_slot","previous_level","status","assigned_to","first_source_code","last_source_code","created_at","updated_at"];
  const csv="\uFEFF"+columns.map(csvCell).join(",")+"\r\n"+(result.results||[]).map(row=>columns.map(c=>csvCell(row[c])).join(",")).join("\r\n");
  return new Response(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":"attachment; filename=hsk-crm-export.csv","cache-control":"no-store","x-content-type-options":"nosniff"}});
}
async function adminSources(req,env){
  if(req.method==="GET"){const result=await env.DB.prepare("SELECT code,label,kind,is_active FROM lead_sources ORDER BY code").all();return reply({ok:true,items:result.results||[]});}
  let data;try{data=await readJson(req)}catch{return reply({error:"invalid_request"},400)}
  const code=cleanText(data.code,48).toLowerCase(),label=cleanText(data.label,100),kind=String(data.kind||"");
  if(!/^[a-z0-9_-]{3,48}$/.test(code)||label.length<2||!SOURCE_TYPES.has(kind))return reply({error:"invalid_fields"},422);
  await env.DB.prepare("INSERT INTO lead_sources(code,label,kind) VALUES(?,?,?)").bind(code,label,kind).run();
  return reply({ok:true,code},201);
}
export default {
  async fetch(req,env,ctx) {
    const url=new URL(req.url),path=url.pathname,method=req.method.toUpperCase();
    const cors=headersForOrigin(req);
    try {
      if(path==="/health"&&method==="GET")return reply({ok:true,storage_ready:!!env.DB,turnstile_ready:!!env.TURNSTILE_SECRET,admin_ready:!!(env.ADMIN_TOKEN&&env.ADMIN_TOKEN.length>=32),telegram_ready:telegramConfigured(env)});
      if(path==="/api/leads"&&method==="OPTIONS")return req.headers.get("origin")===SITE_ORIGIN?
        new Response(null,{status:204,headers:cors}):reply({error:"origin_not_allowed"},403);
      if(path==="/api/leads"&&method==="POST")return postLead(req,env,ctx);
      if(path.startsWith("/api/admin/")){
        if(method==="OPTIONS")return req.headers.get("origin")===SITE_ORIGIN?new Response(null,{status:204,headers:cors}):reply({error:"origin_not_allowed"},403);
        if(!await isAdmin(req,env))return reply({error:"unauthorized"},401,cors);
        let result;
        if(path==="/api/admin/leads"&&method==="GET")result=await adminLeads(url,env);
        else if(path==="/api/admin/leads"&&method==="POST")result=await adminCreateLead(req,env,ctx);
        else if(path==="/api/admin/notifications/flush"&&method==="POST")result=reply({ok:true,...await flushTelegramOutbox(env,15)});
        else if(path==="/api/admin/stats"&&method==="GET")result=await adminStats(env);
        else if(path==="/api/admin/export"&&method==="GET")result=await adminExport(env);
        else if(path==="/api/admin/sources"&&(method==="GET"||method==="POST"))result=await adminSources(req,env);
        else if(path.startsWith("/api/admin/leads/")&&method==="PATCH")result=await adminUpdate(req,env,decodeURIComponent(path.slice("/api/admin/leads/".length)));
        else result=reply({error:"not_found"},404);
        const newHeaders=new Headers(result.headers);for(const [k,v] of Object.entries(cors))newHeaders.set(k,v);
        return new Response(result.body,{status:result.status,headers:newHeaders});
      }
      return reply({error:"not_found"},404);
    } catch(err) {
      // Do not log student names, phone numbers, secrets or request bodies.
      console.error("HSK CRM request failed",String(err?.message||"unknown").slice(0,100));
      return reply({error:"internal_error"},500,cors);
    }
  }
};
