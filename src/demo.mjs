export function demoRecords(origin) {
  return Array.from({ length: 18 }, (_, i) => ({ id: i + 1, title: `Tài liệu mẫu ${i + 1}`, category: ['Nghiên cứu', 'Thiết kế', 'Công nghệ'][i % 3], content: `Bản ghi minh họa số ${i + 1}. Dữ liệu này do tool tạo để kiểm tra phân trang và tải từng cụm.`, fileUrl: `${origin}/demo/files/${i + 1}.txt` }));
}

const layout = (title, body, script = '') => `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:18px 'Segoe UI',sans-serif;max-width:850px;margin:40px auto;padding:20px;background:#edf3f4;color:#173b45}article{background:white;padding:28px;margin:18px 0;min-height:160px;border:1px solid #cad9dd}a,button{color:#246775}h1{font-size:32px}#sentinel{padding:32px;text-align:center}</style><main><h1>${title}</h1><p>Trang dữ liệu minh họa của Cào Cào.</p>${body}</main>${script ? `<script>${script}</script>` : ''}</html>`;
const card = record => `<article data-id="${record.id}"><h2>${record.title}</h2><p>${record.category}</p><p>${record.content}</p></article>`;

export function handleDemo(url, origin) {
  const records = demoRecords(origin);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 5));
  if (url.pathname === '/demo/page') {
    const items = records.slice((page - 1) * limit, page * limit);
    return { json: { data: { items }, meta: { hasMore: page * limit < records.length, total: records.length } } };
  }
  if (url.pathname === '/demo/offset') {
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    return { json: { data: { items: records.slice(offset, offset + limit) }, meta: { hasMore: offset + limit < records.length } } };
  }
  if (url.pathname === '/demo/batches') {
    const names = ['alpha', 'beta', 'gamma'];
    const group = Math.max(0, names.indexOf(url.searchParams.get('batch') || 'alpha'));
    const items = records.slice(group * 6 + (page - 1) * 3, Math.min(group * 6 + page * 3, group * 6 + 6));
    return { json: { data: { items }, meta: { hasMorePages: page < 2, hasMoreBatches: group < 2, nextBatch: names[group + 1] || null } } };
  }
  if (url.pathname === '/demo/infinite') return { html: layout('Danh sách tải theo cụm', '<section id="items"></section><div id="sentinel">Đang tải cụm đầu tiên…</div>', `
    let batch='alpha',page=1,busy=false,finished=false;
    async function load(){
      if(busy||finished)return;busy=true;
      try{
        const response=await fetch('/demo/batches?batch='+batch+'&page='+page+'&limit=3');
        const payload=await response.json();
        for(const item of payload.data.items){const article=document.createElement('article');article.dataset.id=item.id;const h=document.createElement('h2');h.textContent=item.title;const p=document.createElement('p');p.textContent=item.content;article.append(h,p);document.getElementById('items').append(article);}
        if(payload.meta.hasMorePages)page++;else if(payload.meta.hasMoreBatches){batch=payload.meta.nextBatch;page=1;}else finished=true;
        document.getElementById('sentinel').textContent=finished?'Đã tải hết 18 bản ghi mẫu':'Cuộn tới đây để tải cụm tiếp theo';
      }finally{busy=false;}
    }
    new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting))load()},{rootMargin:'50px'}).observe(document.getElementById('sentinel'));
    window.addEventListener('scroll',()=>{if(document.getElementById('sentinel').getBoundingClientRect().top<innerHeight+80)load();});
    load();`) };
  if (url.pathname === '/demo/paginated') return { html: layout('Danh sách có phân trang', records.slice((page - 1) * 5, page * 5).map(card).join('') + (page * 5 < records.length ? `<nav><a rel="next" href="/demo/paginated?page=${page + 1}">Trang tiếp</a></nav>` : '<p>Đã hết trang.</p>')) };
  if (url.pathname === '/demo/article') return { html: layout('Một bài viết mẫu', '<article><h2>Nội dung một trang</h2><p>Tool có thể lưu văn bản và liên kết khi trang không cung cấp một API JSON có cấu trúc.</p></article>') };
  if (url.pathname === '/demo/blocked') return { status: 403, html: layout('Xác minh truy cập', '<p>Verify that you are human. Đây là trang mẫu kiểm tra thông báo bị chặn.</p>') };
  const file = url.pathname.match(/^\/demo\/files\/(\d+)\.txt$/);
  if (file) return { text: `File minh họa cho bản ghi ${file[1]}.\n`, mime: 'text/plain; charset=utf-8' };
  return null;
}
