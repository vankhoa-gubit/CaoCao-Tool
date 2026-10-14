import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url))),[major,minor]=process.versions.node.split('.').map(Number);
if(major<22||major===22&&minor<13){console.error('Cần Node.js 22.13 trở lên. Cài bản LTS rồi mở lại start.cmd.');process.exit(1);}
try{await access(join(root,'node_modules','playwright'));}catch{console.log('Đang chuẩn bị ứng dụng lần đầu…');const setup=spawn(process.platform==='win32'?'npm.cmd':'npm',['ci','--ignore-scripts'],{cwd:root,stdio:'inherit',shell:process.platform==='win32',windowsHide:true});const code=await new Promise(resolve=>{setup.on('error',()=>resolve(1));setup.on('exit',resolve);});if(code!==0){console.error('Chưa tải được thư viện ứng dụng. Kiểm tra kết nối mạng rồi mở lại start.cmd.');process.exit(1);}}
if(process.platform==='win32'){
  const candidates=[join(process.env.PROGRAMFILES||'C:\\Program Files','Google','Chrome','Application','chrome.exe'),join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Google','Chrome','Application','chrome.exe'),join(process.env.PROGRAMFILES||'C:\\Program Files','Microsoft','Edge','Application','msedge.exe'),join(process.env['PROGRAMFILES(X86)']||'C:\\Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),join(process.env.LOCALAPPDATA||root,'Google','Chrome','Application','chrome.exe'),join(process.env.LOCALAPPDATA||root,'Microsoft','Edge','Application','msedge.exe')];
  const installed=await Promise.all(candidates.map(path=>access(path).then(()=>true,()=>false)));
  if(!installed.some(Boolean)){const {chromium}=await import('playwright');try{await access(chromium.executablePath());}catch{console.error('Chưa tìm thấy Chrome/Edge. Cài một trình duyệt hoặc chạy: npx playwright install chromium');process.exit(1);}}
}
if(process.argv.includes('--check')){console.log('Cào Cào đã sẵn sàng. Mở start.cmd để dùng ứng dụng.');process.exit(0);}
const child=spawn(process.execPath,[join(root,'src','server.mjs'),'--open'],{cwd:root,stdio:'inherit',windowsHide:true});
child.on('error',()=>{console.error('Không mở được ứng dụng. Kiểm tra Node.js và quyền đọc thư mục.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
