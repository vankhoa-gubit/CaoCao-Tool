import { csvValue } from './jobs.mjs';
import { MessageError } from './messages.mjs';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const stylesheet = 'body{font:17px/1.65 "Segoe UI",Tahoma,sans-serif;color:#173b45;max-width:820px;margin:40px auto;padding:0 24px}h1,h2{line-height:1.3}article{break-inside:auto;margin:0 0 40px}p{white-space:pre-wrap;overflow-wrap:anywhere}.source{font-size:13px;color:#526b73}li{overflow-wrap:anywhere}a{color:#286775}@media print{body{margin:0;max-width:none;padding:0}article+article{break-before:page}}';
export function itemHtml(row) { return `<article><h1>${escapeHtml(row.title)}</h1><p class="source"><a href="${escapeHtml(row.url)}">${escapeHtml(row.url)}</a><br>${escapeHtml(row.saved_at)}</p><p>${escapeHtml(row.body)}</p>${row.choices.length?'<ol>'+row.choices.map(choice=>'<li>'+escapeHtml(choice)+'</li>').join('')+'</ol>':''}${row.answer?'<h2>Đáp án / Answer</h2><p>'+escapeHtml(row.answer)+'</p>':''}${row.notes?'<h2>Ghi chú / Notes</h2><p>'+escapeHtml(row.notes)+'</p>':''}</article>`; }
export const htmlStart = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>Cào Cào</title><style>${stylesheet}</style></head><body>`;
export async function* learningExport(rows,format) {
  if(!['html','md','csv'].includes(format))throw new MessageError('export.format');
  if(format==='html')yield htmlStart;
  if(format==='csv')yield '\ufeff'+['title','content','choices','answer','source','saved_at','notes','tags'].map(csvValue).join(',')+'\r\n';
  for await(const row of rows){
    if(format==='html')yield itemHtml(row);
    else if(format==='csv')yield [row.title,row.body,row.choices,row.answer,row.url,row.saved_at,row.notes,row.tags].map(csvValue).join(',')+'\r\n';
    else yield `# ${row.title.replace(/[\r\n]/g,' ')}\n\n${row.url}\n${row.saved_at}\n\n${row.body}\n\n${row.choices.map((choice,index)=>`${index+1}. ${choice}`).join('\n')}${row.answer?'\n\nĐáp án / Answer: '+row.answer:''}${row.notes?'\n\n## Ghi chú / Notes\n\n'+row.notes:''}\n\n---\n\n`;
  }
  if(format==='html')yield '</body></html>';
}
export async function learningPdf(rows,sessions,signal) {
  let html=htmlStart,count=0;
  for await(const row of rows){html+=itemHtml(row);if(++count>500||Buffer.byteLength(html)>10*1024*1024)throw new MessageError('learning.pdfLimit');}
  const session=await sessions.open('http://localhost',{signal,lightweight:true});
  try{await session.page.route('**/*',route=>route.abort());await session.page.setContent(html+'</body></html>');return await session.page.pdf({format:'A4',printBackground:true,margin:{top:'18mm',right:'16mm',bottom:'18mm',left:'16mm'}});}finally{await session.close();}
}
