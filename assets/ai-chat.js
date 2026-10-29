// HSK AI Customer web channel. No secrets, no local/session storage.
(()=>{
"use strict";
const base="https://an-chau-hsk-crm-api.phonganh99.workers.dev";
const $=id=>document.getElementById(id);
const launch=$("aiChatLaunch"),panel=$("aiChatPanel"),body=$("aiChatBody");
if(!launch||!panel||!body)return;
const consent=$("aiChatConsent"),status=$("aiChatFeedback");
const start=$("aiChatStart"),init=$("aiChatInit"),active=$("aiChatActive");
const text=$("aiChatInput"),send=$("aiChatSend"),handoff=$("aiChatHandoff");
let session=null,turnstileId=null,captchaToken="",busy=false,humanMode=false;
function notice(msg){status.textContent=msg}
function bubble(message,kind="bot"){
 const element=document.createElement("div");
 element.className="ai-chat-message "+kind;
 element.textContent=message;
 body.append(element);
 body.scrollTop=body.scrollHeight;
}
function setOpen(open){
 panel.hidden=!open;launch.setAttribute("aria-expanded",String(open));
 launch.setAttribute("aria-label",open?"Đóng AI tư vấn":"Mở AI tư vấn HSK");
 if(open){ if(!session)mountTurnstile(); (session?text:consent).focus({preventScroll:true}); }
 else launch.focus({preventScroll:true});
}
launch.addEventListener("click",()=>setOpen(panel.hidden));
$("aiChatClose").addEventListener("click",()=>setOpen(false));
document.addEventListener("keydown",ev=>{if(ev.key==="Escape"&&!panel.hidden)setOpen(false)});
function mountTurnstile(){
 if(turnstileId!==null)return;
 let tries=0;
 const check=()=>{
  if(panel.hidden||turnstileId!==null)return;
  if(window.turnstile&&typeof window.turnstile.render==="function"){
   try{turnstileId=window.turnstile.render("#aiChatChallenge",{
    sitekey:"0x4AAAAAAFpbRuHMIYl9LmGw",action:"hsk_ai_chat",theme:"light",size:"flexible",
    callback:token=>{captchaToken=token;notice("")},
    "expired-callback":()=>{captchaToken="";notice("Xác minh đã hết hạn, vui lòng thử lại.")},
    "error-callback":()=>{captchaToken="";notice("Không tải được xác minh. Vui lòng thử lại hoặc dùng Zalo.")}
   })}catch{notice("Không thể tải bước xác minh bảo mật.")}
  }else if(++tries<12)setTimeout(check,500);
  else notice("Không tải được xác minh. Kiểm tra mạng hoặc dùng Zalo để liên hệ.");
 };
 check();
}
async function api(path,payload){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),13000);
 try{
  const r=await fetch(base+path,{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},
   body:JSON.stringify(payload),signal:controller.signal});
  const data=await r.json().catch(()=>({error:"server_unavailable"}));
  if(!r.ok||!data.ok)throw Error(data.error||"Không thể kết nối");
  return data;
 }finally{clearTimeout(timer)}
}
function showError(e){
 const msg=e?.message||"Không có kết nối";
 if(msg==="ai_not_enabled")notice("AI Chat chưa được kích hoạt. Anh/chị có thể đăng ký bằng form hoặc liên hệ Zalo.");
 else if(msg==="verification_failed")notice("Xác minh bảo mật chưa hợp lệ. Vui lòng xác minh lại.");
 else if(msg==="rate_limited")notice("Đã vượt giới hạn yêu cầu. Vui lòng thử lại sau.");
 else if(msg==="unauthorized_session")notice("Phiên chat đã hết hạn. Vui lòng tải lại trang để bắt đầu phiên mới.");
 else notice("Tạm thời chưa kết nối được. Vui lòng thử lại hoặc liên hệ Zalo.");
}
start.addEventListener("click",async()=>{
 if(busy)return;
 if(!consent.checked){notice("Vui lòng đồng ý thông báo bảo mật trước khi chat.");return}
 if(!captchaToken){notice("Vui lòng hoàn thành xác minh bảo mật.");return}
 busy=true;start.disabled=true;notice("Đang mở phiên tư vấn…");
 try{
  const result=await api("/api/ai/session",{turnstile_token:captchaToken,consent:true,privacy_notice_version:"hsk-ai-v1"});
  session={id:result.session_id,token:result.session_token};
  init.hidden=true;active.hidden=false;notice("");
  bubble("Em là trợ lý tư vấn HSK An Châu. Em hỗ trợ tìm hiểu HSK 1–3 và chuyển yêu cầu đến nhân viên khi cần. Anh/chị đang quan tâm khóa nào?","bot");
  if(result.mode==="guided_fallback")bubble("Hiện hệ thống đang trả lời theo FAQ giới hạn; thông tin chính sách cần nhân viên xác nhận.","system");
  text.focus({preventScroll:true});
 }catch(e){showError(e);if(window.turnstile&&turnstileId!==null)window.turnstile.reset(turnstileId);captchaToken=""}
 finally{busy=false;start.disabled=false}
});
async function sendText(value){
 if(!session||busy)return;
 const message=value.trim().slice(0,1200);
 if(message.length<2){notice("Vui lòng nhập ít nhất 2 ký tự.");return}
 busy=true;send.disabled=true;text.disabled=true;notice("Đang xử lý…");
 bubble(message,"user");text.value="";
 try{
  const res=await api("/api/ai/message",{session_id:session.id,session_token:session.token,message});
  bubble(res.text||"An Châu chưa thể phản hồi. Vui lòng thử lại.","bot");
  notice(res.mode==="guided_fallback"?"FAQ tự động · Thông tin cần xác nhận bởi nhân viên.":"");
  if(res.session_state==="human")humanMode=true;
 }catch(e){bubble("Chưa gửi được phản hồi. Bạn có thể thử lại hoặc nhắn Zalo.","system");showError(e)}
 finally{busy=false;text.disabled=humanMode;send.disabled=humanMode}
}
$("aiChatComposer").addEventListener("submit",ev=>{ev.preventDefault();void sendText(text.value)});
text.addEventListener("keydown",ev=>{if(ev.key==="Enter"&&!ev.shiftKey){ev.preventDefault();void sendText(text.value)}});
document.querySelectorAll("[data-ai-suggest]").forEach(btn=>btn.addEventListener("click",()=>{
 const query=btn.getAttribute("data-ai-suggest")||"";
 if(!session){notice("Hãy xác minh và bắt đầu trò chuyện trước.");return}
 void sendText(query);
}));
$("aiChatAskSale").addEventListener("click",()=>{
 handoff.hidden=!handoff.hidden;
 if(!handoff.hidden)$("aiChatName").focus({preventScroll:true});
});
$("aiChatHandoffForm").addEventListener("submit",async ev=>{
 ev.preventDefault();
 if(!session||busy)return;
 const form=ev.currentTarget;
 if(!form.reportValidity())return;
 if(!$("aiChatHandoffConsent").checked){notice("Cần đồng ý chuyển thông tin để tư vấn viên liên hệ.");return}
 const btn=$("aiChatHandoffSubmit");btn.disabled=true;busy=true;notice("Đang chuyển yêu cầu đến An Châu…");
 try{
  const res=await api("/api/ai/handoff",{
   session_id:session.id,session_token:session.token,
   full_name:$("aiChatName").value.trim(),phone:$("aiChatPhone").value.trim(),
   course:$("aiChatCourse").value,office:$("aiChatOffice").value,
   consent:true,privacy_notice_version:"hsk-ai-v1"
  });
  bubble("Đã ghi nhận yêu cầu tư vấn (mã "+(res.lead_code||"đã nhận")+
    "). "+(res.assigned?"Đã có nhân viên phụ trách.":"An Châu đang chờ phân công nhân viên.")+
    " AI sẽ tạm dừng trả lời trong phiên này.","bot");
  handoff.hidden=true;$("aiChatAskSale").disabled=true;humanMode=true;text.disabled=true;send.disabled=true;
  notice("Đã chuyển yêu cầu. Nhân viên sẽ chủ động liên hệ theo thông tin bạn cung cấp.");
 }catch(e){showError(e)}
 finally{busy=false;btn.disabled=false}
});
})();
