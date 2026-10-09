import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createApp,listen,projectRoot} from '../src/server.mjs';
import {BrowserSessions} from '../src/browser.mjs';
let app,origin,directory,ui,articleId,questionId;const errors=[];
async function until(read,predicate,ms=20000){const end=Date.now()+ms;for(;;){const value=await read();if(predicate(value))return value;if(Date.now()>end)throw new Error('Expected learning UI state not reached');await new Promise(resolve=>setTimeout(resolve,60));}}
async function refresh(){await ui.page.locator('#learning-refresh').click();await until(()=>ui.page.locator('#learning-refresh').isEnabled(),Boolean);}
before(async()=>{await mkdir(join(projectRoot,'.qa'),{recursive:true});directory=await mkdtemp(join(projectRoot,'.qa','learning-ui-'));await mkdir(join(directory,'screenshots'));app=await createApp({dataDirectory:directory,scanOptions:{rounds:1,waitMs:300}});origin=await listen(app,0);ui=await new BrowserSessions(join(directory,'ui-session')).open(origin,{acceptDownloads:true});ui.page.on('pageerror',error=>errors.push(error.message));await ui.page.goto(origin+'/#library');await ui.page.locator('#learning-title').waitFor();});
after(async()=>{await ui?.close();await app?.close();console.log('Learning UI evidence: '+directory);});

test('URL → preview → collection → save → reader works without technical configuration',async()=>{
  const page=ui.page;assert.equal(await page.locator('#library-panel').isVisible(),true);assert.equal(await page.locator('#advanced').isVisible(),false);
  await page.locator('#learning-collection-name').fill('Tủ sách cá nhân');await page.locator('#learning-collection-form button').click();await until(()=>page.locator('#learning-destination option').allTextContents(),labels=>labels.includes('Tủ sách cá nhân'));
  await page.locator('[data-learning-demo="article"]').click();await until(()=>page.locator('#learning-sample').isVisible(),Boolean);assert.ok((await page.locator('#learning-sample-body').textContent()).includes('Đọc có chủ đích'));
  await page.locator('#learning-save').click();await until(()=>app.library.list({kind:'article'}).pagination.total,total=>total===1);await refresh();articleId=app.library.list({kind:'article'}).items[0].id;
  await page.locator(`[data-learning-id="${articleId}"]`).click();await page.locator('#learning-reader[open]').waitFor();assert.ok((await page.locator('#learning-reader-body').textContent()).includes('Trước khi đọc'));
});
test('Reader notes, tags and form focus survive language switches and refresh',async()=>{
  const page=ui.page;await page.locator('#learning-reader-notes').fill('Ghi chú của tôi');await page.locator('#learning-reader-tags').fill('Ôn tập, Đọc');await page.locator('#learning-reader-notes').focus();
  await page.evaluate(()=>document.querySelector('[data-language="en"]').click());assert.equal(await page.locator('#learning-reader-notes').inputValue(),'Ghi chú của tôi');assert.equal(await page.evaluate(()=>document.activeElement.id),'learning-reader-notes');
  await page.locator('#learning-note-form button').click();await until(()=>app.library.item(articleId).notes,value=>value==='Ghi chú của tôi');assert.deepEqual(app.library.item(articleId).tags,['Ôn tập','Đọc']);
  await page.locator('#learning-close').click();await page.locator('#learning-search').fill('ghi chu');await until(()=>page.locator('#learning-items .learning-row').count(),count=>count===1);await page.locator('#learning-search').fill('không có kết quả xyz');await until(()=>page.locator('#learning-items .learning-row').count(),count=>count===0);assert.equal(await page.locator('#learning-empty').textContent(),'No content matches these filters.');await page.locator('#learning-search').fill('');await refresh();
});
test('List preview stores full article bodies and the old workspace panels remain reachable',async()=>{
  const page=ui.page;await page.locator('[data-learning-demo="list"]').click();await until(()=>page.locator('#learning-sample-count').textContent(),text=>text.includes('3 items'));await page.locator('#learning-save').click();await until(()=>app.library.list({kind:'article'}).pagination.total,count=>count===3);await refresh();
  for(const panel of ['quick','sources','data','library']){await page.locator(`[data-panel="${panel}"]`).click();assert.equal(await page.locator('#'+panel+'-panel').isVisible(),true);}assert.equal(errors.length,0);
});
test('PDF collection shows independent file status and a usable local reader link',async()=>{
  const page=ui.page;await page.locator('[data-learning-demo="document"]').click();await until(()=>page.locator('#learning-sample-body').textContent(),text=>text.includes('guide.pdf'));assert.equal(await page.locator('#learning-files').isChecked(),true);await page.locator('#learning-save').click();
  const document=await until(()=>app.library.list({kind:'document'}).items[0],Boolean);await until(()=>app.library.item(document.id).attachments[0]?.status,status=>status==='done');await refresh();await page.locator(`[data-learning-id="${document.id}"]`).click();
  const href=await page.locator('#learning-file-list a').getAttribute('href');assert.ok(href.startsWith('/api/library/files/'));assert.equal((await fetch(origin+href)).status,200);await page.locator('#learning-close').click();
});
test('Question URL → detection → import → cards supports source answers, missing answers and keyboard navigation',async()=>{
  const page=ui.page;await page.locator('[data-learning-demo="question"]').click();await until(()=>page.locator('#learning-mapping').isVisible(),Boolean,60000);assert.equal(await page.locator('#learning-field-question').inputValue(),'question');
  const originalSample=await page.locator('#learning-sample-body article').first().textContent();await page.locator('#learning-field-answer').selectOption('id');await until(()=>page.locator('#learning-sample-body article').first().textContent(),text=>/Answer from source: \d+$/.test(text));await page.locator('#learning-field-answer').selectOption('answer');await until(()=>page.locator('#learning-sample-body article').first().textContent(),text=>text===originalSample);assert.equal(await page.locator('#learning-save').isEnabled(),true);
  await page.locator('#learning-save').click();await until(()=>app.library.list({kind:'question'}).pagination.total,count=>count===6,60000);await refresh();questionId=app.library.list({kind:'question'}).items[0].id;
  await page.locator(`[data-learning-id="${questionId}"]`).click();await page.locator('#learning-study').click();assert.equal(await page.locator('.learning-answer').count(),0);await page.locator('#learning-reveal').click();assert.equal(await page.locator('.learning-answer').textContent(),'The source has not provided an answer.');
  await page.locator('#learning-reader-body').click();await page.keyboard.press('ArrowRight');await until(()=>page.locator('#learning-reader-title').textContent(),text=>text.includes('Ý chính'));assert.equal(await page.locator('.learning-answer').count(),0);await page.locator('#learning-reveal').click();assert.ok((await page.locator('.learning-answer').textContent()).length>20);
});
test('Reader export download is a real PDF; Escape closes the reader',async()=>{
  const page=ui.page,download=page.waitForEvent('download');await page.locator('[data-learning-item-export="pdf"]').click();const file=await download,path=await file.path();assert.equal((await readFile(path)).subarray(0,5).toString(),'%PDF-');await file.saveAs(join(directory,'reader-export.pdf'));await page.keyboard.press('Escape');assert.equal(await page.locator('#learning-reader').isVisible(),false);
});
test('Vietnamese/English library and reader fit desktop, tablet and mobile; screenshots retained',async()=>{
  const page=ui.page;for(const language of ['vi','en']){await page.locator(`[data-language="${language}"]`).click();for(const [width,height] of [[1440,900],[768,1024],[390,844]]){
    await page.setViewportSize({width,height});await page.screenshot({path:join(directory,'screenshots',`library-${language}-${width}.png`),fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${language} ${width} page overflow`);
    await page.locator(`[data-learning-id="${articleId}"]`).click();await page.locator('#learning-reader[open]').waitFor();assert.equal(await page.locator('#learning-reader').isVisible(),true);await page.screenshot({path:join(directory,'screenshots',`reader-${language}-${width}.png`)});
    const clipped=await page.locator('#learning-reader').evaluate(node=>[...node.querySelectorAll('input,select,textarea,button')].filter(control=>{const rect=control.getBoundingClientRect();return rect.width>0&&(rect.left<0||rect.right>innerWidth+1);}).map(control=>control.id));assert.deepEqual(clipped,[],`${language} ${width} clipped controls`);await page.keyboard.press('Escape');
  }}assert.deepEqual(errors,[]);
});
