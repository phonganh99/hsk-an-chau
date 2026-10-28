import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script} from "node:vm";
const html=readFileSync(new URL("../admin/index.html",import.meta.url),"utf8");
const inline=html.match(/<script>([\s\S]*?)<\/script>/i);
test("Admin CRM inline JavaScript is valid",()=>{
  assert.ok(inline?.[1],"Inline script missing");
  assert.doesNotThrow(()=>new Script(inline[1],{filename:"crm/admin/index.html"}));
});
test("Zalo connection button is wired to visible feedback and timeout",()=>{
  assert.match(html,/id="zaloCheck"/);
  assert.match(html,/addEventListener\("click",\(\)=>\{void zaloCheck\(\);\}\)/);
  assert.match(html,/btn\.textContent="Đang kiểm tra\.\.\."/);
  assert.match(html,/btn\.textContent="Kiểm tra kết nối"/);
  assert.match(html,/controller\.abort\(\)/);
});
