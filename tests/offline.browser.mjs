/** Loads a single HTML through file:// while the browser is disconnected. */
import test, {before, after, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdir, copyFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve, isAbsolute} from 'node:path';
const moduleName=process.env.PLAYWRIGHT_MODULE || 'playwright';
const {chromium}=await import(isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
const root=fileURLToPath(new URL('../',import.meta.url));
const entry=resolve(root,'output/offline/Football-HyperGraph-Explorer.html');
let browser,context,page,errors,requests;
const choose=id=>page.locator(`.pa-shortcut[data-pa-player="${id}"]`).click();
const metric=name=>page.locator(`[data-metric="${name}"] .pa-metric-value`);
before(async()=>{
  await readFile(entry);
  browser=await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ?{headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}
    :{headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'chrome'});
});
after(async()=>await browser?.close());
beforeEach(async()=>{
  context=await browser.newContext({offline:true,viewport:{width:1440,height:1000}});
  page=await context.newPage(); page.setDefaultTimeout(10000); errors=[];requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('request',r=>requests.push(r.url()));
  await page.goto(pathToFileURL(entry).href);
  await page.locator('.hg-edge').first().waitFor();
});
afterEach(async()=>{
  await context?.close();
  assert.deepEqual(errors,[]);
  assert.deepEqual(requests.filter(url=>/^https?:/.test(url)),[],'No network request is allowed');
  assert.equal(requests.filter(url=>url.startsWith('file:')).length,1,'Only the HTML may be loaded from disk');
});
test('disconnected file page mounts all four actual modules and embeds their assets',async()=>{
  assert.match(await page.locator('#app-status').textContent(),/4407.*531.*385/);
  for(const selector of ['.de-root','.hg-panel','.pa-panel','.ct-panel','.hg-svg'])assert.equal(await page.locator(selector).count(),1);
  assert.equal(await page.locator('#app-errors').isVisible(),false);
  assert.equal(await page.evaluate(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0)),true);
});
test('real player, competition source and source evidence remain interactive offline',async()=>{
  await choose('5503');
  assert.equal(await metric('passes').textContent(),'60');
  await page.getByRole('button',{name:'Competition · 对抗',exact:true}).click();
  assert.equal(await page.locator('.hg-panel').getAttribute('data-raw-count'),'385');
  assert.match(await page.locator('.pa-edge-total').textContent(),/87 个/);
  await page.locator('.hg-choice').first().click();
  assert.match(await page.locator('.hg-detail').textContent(),/事件|片段/);
});
test('time range updates the existing C panel and B graph on the same raw data',async()=>{
  await choose('3009');
  await page.getByRole('button',{name:'Competition · 对抗',exact:true}).click();
  await page.getByLabel('开始分钟数值',{exact:true}).fill('80');
  await page.getByLabel('结束分钟数值',{exact:true}).fill('81');
  assert.equal(await metric('goals').textContent(),'1');
  assert.match(await page.locator('[data-metric="goals"] .pa-metric-full').textContent(),/全场 3/);
  assert.equal(await page.locator('.hg-panel').getAttribute('data-raw-count'),'5');
  await page.getByLabel('结束分钟数值',{exact:true}).fill('0');
  assert.equal(await page.locator('.hg-panel').getAttribute('data-raw-count'),'0');
});
test('100 mode changes reuse one renderer and keep the selected player',async()=>{
  await choose('5503');
  await page.locator('.hg-svg').evaluate(svg=>{svg.dataset.offlineIdentity='retained';});
  await page.evaluate(()=>{for(let i=0;i<100;i++)document.querySelector(`[data-mode="${i%2?'collaboration':'competition'}"]`).click();});
  assert.equal(await page.locator('.hg-svg').count(),1);
  assert.equal(await page.locator('.hg-svg').getAttribute('data-offline-identity'),'retained');
  assert.match(await page.locator('.pa-name').textContent(),/Messi/);
});
test('overview, shots and comparison use the actual A/C modules',async()=>{
  await choose('5503');
  await page.getByRole('tab',{name:'射门分析',exact:true}).click();
  assert.equal(await page.locator('.pa-shot-mark').count(),5);
  await page.getByRole('tab',{name:'球员对比',exact:true}).click();
  await page.getByLabel('选择对比球员',{exact:true}).selectOption('3009');
  assert.equal(await page.locator('.pa-compare-row').count(),8);
  await page.getByRole('tab',{name:'比赛概览',exact:true}).click();
  assert.equal(await page.locator('.de-root').isVisible(),true);
});
test('the HTML works after being copied alone into an unrelated folder',async()=>{
  const directory=resolve(root,'output/offline-isolated'); await mkdir(directory,{recursive:true});
  const target=resolve(directory,'index.html'); await copyFile(entry,target);
  requests=[];
  await page.goto(pathToFileURL(target).href);
  await page.locator('.hg-edge').first().waitFor();
  assert.match(await page.locator('#app-status').textContent(),/531.*385/);
});
test('offline page fits mobile, with a real screenshot for review',async()=>{
  for(const width of [320,360,768]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:resolve(root,'output/offline/preview.png'),fullPage:true});
});
