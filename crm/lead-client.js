/**
 * HSK CRM form bridge — STAGED, not loaded by the live Landing Page yet.
 * Activate only after Worker, D1, Turnstile and privacy policy are ready.
 * Requires window.HSK_CRM_CONFIG with enabled:true and correct public settings.
 */
(function(){
  "use strict";
  const cfg=window.HSK_CRM_CONFIG||{};
  if(cfg.enabled!==true||!cfg.apiBase||!cfg.siteKey||cfg.privacyNoticeVersion!=="hsk-privacy-v1")return;
  const form=document.getElementById("demoForm");
  const button=form?.querySelector('button[type="submit"]');
  if(!form||!button)return;
  const api=new URL(cfg.apiBase);
  if(api.protocol!=="https:")return;
  const source=(new URL(location.href)).searchParams.get("ref")||"direct";
  const status=document.createElement("p");
  status.className="crm-form-feedback";
  status.setAttribute("role","status");
  status.setAttribute("aria-live","polite");
  status.style.cssText="margin:14px 0 0;font-size:13px;line-height:1.6;color:#7a4e28";
  const widget=document.createElement("div");widget.id="hsk-turnstile";
  widget.style.cssText="margin:16px 0 0;min-height:65px";
  const privacy=document.createElement("p");
  privacy.style.cssText="font-size:12px;line-height:1.55;color:#796a5a;margin:14px 0 0";
  const privacyLink=document.createElement("a");
  privacyLink.href="/chinh-sach-bao-mat/";
  privacyLink.textContent="Chính sách bảo mật";
  privacyLink.style.cssText="color:#c75524;text-decoration:underline";
  privacy.append("An Châu sử dụng thông tin bạn cung cấp để liên hệ tư vấn khóa học. Xem ",privacyLink," trước khi đăng ký.");
  button.parentElement.insertBefore(privacy,button);
  button.parentElement.insertBefore(widget,button);
  button.parentElement.appendChild(status);
  button.disabled=true;status.textContent="Đang tải xác minh bảo mật...";
  let widgetId=null;
  let initialized=false;
  function ready(){
    if(!window.turnstile)return false;
    widgetId=window.turnstile.render(widget,{sitekey:cfg.siteKey,action:"hsk_registration"});
    button.disabled=false;status.textContent="";
    initialized=true;
    window.HSK_CRM_READY=true;
    return true;
  }
  const script=document.createElement("script");
  script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async=true;script.defer=true;
  script.onload=()=>{if(!ready()){status.textContent="Không thể khởi tạo xác minh bảo mật."}};
  script.onerror=()=>{status.textContent="Không tải được xác minh bảo mật. Bạn có thể liên hệ An Châu qua hotline."};
  document.head.appendChild(script);
  form.addEventListener("submit",async ev=>{
    if(!initialized)return;
    ev.preventDefault();
    if(!form.reportValidity())return;
    const turnstileToken=window.turnstile?.getResponse(widgetId);
    if(!turnstileToken){status.textContent="Vui lòng hoàn thành xác minh bảo mật trước khi gửi.";return;}
    button.disabled=true;status.textContent="Đang gửi thông tin...";
    const controller=new AbortController();
    const stop=setTimeout(()=>controller.abort(),12000);
    try{
      const payload={
        full_name:document.getElementById("name").value.trim(),
        phone:document.getElementById("phone").value.trim(),
        office:document.getElementById("office").value,
        course:document.getElementById("course").value,
        preferred_slot:document.getElementById("slotSelect").value,
        previous_level:document.getElementById("level").value,
        source_code:source,
        privacy_notice_version:cfg.privacyNoticeVersion,
        turnstile_token:turnstileToken,
        company_website:""
      };
      const response=await fetch(api.origin+"/api/leads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:controller.signal,cache:"no-store"});
      if(!response.ok)throw new Error("server_error");
      const result=await response.json();
      if(result.ok!==true||!result.lead_code)throw new Error("invalid_confirmation");
      status.style.color="#286b49";
      status.textContent="An Châu đã nhận yêu cầu tư vấn của bạn. Nhân viên sẽ liên hệ để xác nhận khóa học và lịch khai giảng.";
      button.disabled=true;
      form.querySelectorAll("input,select").forEach(el=>el.disabled=true);
      form.querySelector("#success")?.classList.remove("show");
    }catch{
      status.style.color="#a73521";
      status.textContent="Chưa gửi được đăng ký. Vui lòng thử lại hoặc liên hệ Zalo 0923 181 123.";
      button.disabled=false;window.turnstile?.reset(widgetId);
    }finally{clearTimeout(stop)}
  });
})();
