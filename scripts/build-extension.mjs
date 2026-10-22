import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = dirname(dirname(fileURLToPath(import.meta.url))), extension = join(root, 'extension');
const table = Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0; });
export function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = table[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); }
function icon(size) {
  const rows = Buffer.alloc(size * (1 + size * 4)), scale = size / 128;
  const lines = [[25,88,63,46],[63,46,98,89],[38,89,64,67],[64,67,94,89],[64,47,87,28],[81,28,98,36],[63,67,48,43],[48,43,32,31]];
  const distance = (x,y,line) => { const [a,b,c,d] = line, dx = c-a, dy = d-b, t = Math.max(0,Math.min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a-t*dx,y-b-t*dy); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / scale, py = (y + .5) / scale, ink = lines.some(line => distance(px,py,line)<4) || Math.hypot(px-94,py-31)<6;
    const offset = y * (1+size*4) + 1 + x*4;
    rows.set(ink ? [255,255,255,255] : [40,103,117,255], offset);
  }
  const header = Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
export function zipFiles(files) {
  const locals = [], central = [];let offset = 0;
  for (const { name, bytes } of files) {
    const filename = Buffer.from(name), crc = crc32(bytes), local = Buffer.alloc(30), entry = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x800,8);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    locals.push(local,filename,bytes);central.push(entry,filename);offset += local.length+filename.length+bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,directory,end]);
}
export async function buildExtension({ quiet = false } = {}) {
  const manifest = JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
  await mkdir(join(extension,'icons'),{recursive:true});
  for (const size of [16,32,48,128]) await writeFile(join(extension,'icons',`${size}.png`),icon(size));
  const allowed = ['manifest.json','worker.js','reader.js','content.js','i18n.js','popup.html','popup.js','popup.css','help.html','help.js','icons/16.png','icons/32.png','icons/48.png','icons/128.png'];
  const files = await Promise.all(allowed.map(async name=>({name,bytes:await readFile(join(extension,name))})));
  for (const file of files) if (/\.js$/.test(file.name) && /(?:eval\s*\(|new\s+Function\s*\(|https?:\/\/.*\.js['"])/.test(file.bytes.toString())) throw new Error('Executable remote content is not permitted in the extension');
  await mkdir(join(root,'dist'),{recursive:true});
  const target = join(root,'dist',`CaoCao-Extension-${manifest.version}.zip`), bytes = zipFiles(files);await writeFile(target,bytes);
  if (!quiet) console.log(`Extension ${manifest.version}: ${files.length} files → ${target}`);
  return {target,files:allowed,bytes};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildExtension();
