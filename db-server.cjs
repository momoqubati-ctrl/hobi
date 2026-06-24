#!/usr/bin/env node
/**
 * متصفح قاعدة البيانات - خادم مستقل
 * يعمل على البورت 5050 مثل MinIO على 9001
 *
 * التشغيل: node db-server.js
 * الرابط: http://localhost:5050
 */
const http = require("http");
const { Pool } = require("pg");

const PORT = 5050;
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5433/chat_app";

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PostgreSQL Browser</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--green:#22c55e;--red:#f87171;--yellow:#fbbf24}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column}
header{background:var(--card);border-bottom:1px solid var(--border);padding:10px 20px;display:flex;align-items:center;gap:16px;flex-shrink:0}
header h1{font-size:15px;color:var(--accent);white-space:nowrap}
header .badge{background:#164e63;color:var(--accent);padding:2px 10px;border-radius:8px;font-size:11px;font-weight:bold}
.search-box{flex:1;max-width:400px}
.search-box input{width:100%;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:12px}
.layout{display:flex;flex:1;overflow:hidden}
.sidebar{width:220px;background:var(--card);border-left:1px solid var(--border);overflow-y:auto;flex-shrink:0;padding:8px}
.sidebar h3{font-size:11px;color:var(--muted);padding:8px 12px;text-transform:uppercase;letter-spacing:1px}
.table-btn{width:100%;padding:8px 12px;border:none;background:transparent;color:var(--muted);text-align:right;cursor:pointer;border-radius:8px;font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;transition:all .15s}
.table-btn:hover{background:var(--bg);color:var(--text)}
.table-btn.active{background:var(--accent);color:#0f172a}
.table-btn .count{font-size:10px;opacity:.6}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.toolbar{padding:8px 16px;display:flex;gap:8px;align-items:center;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}
.toolbar button{padding:5px 14px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--accent);cursor:pointer;font-size:12px;font-weight:600;transition:all .15s}
.toolbar button:hover{background:var(--border)}
.toolbar button.primary{background:var(--accent);color:#0f172a;border-color:var(--accent)}
.toolbar .info{color:var(--muted);font-size:11px;margin-right:auto}
.table-wrap{flex:1;overflow:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:var(--card);color:var(--muted);padding:10px 12px;text-align:left;position:sticky;top:0;white-space:nowrap;border-bottom:2px solid var(--border);font-family:monospace;font-size:11px;cursor:pointer;user-select:none}
th:hover{color:var(--accent)}
td{padding:8px 12px;border-bottom:1px solid rgba(51,65,85,.4);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#cbd5e1;font-size:12px}
tr:hover td{background:rgba(56,189,248,.04)}
tr.selected td{background:rgba(56,189,248,.1)}
.pagination{padding:8px 16px;display:flex;gap:8px;align-items:center;border-top:1px solid var(--border);flex-shrink:0;background:var(--card)}
.pagination button{padding:4px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--accent);cursor:pointer;font-size:12px}
.pagination button:disabled{opacity:.3;cursor:not-allowed}
.pagination span{color:var(--muted);font-size:12px}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:100}
.modal{background:var(--card);border:1px solid var(--border);border-radius:16px;width:90%;max-width:700px;max-height:80vh;overflow:auto;padding:20px}
.modal h2{font-size:16px;color:var(--accent);margin-bottom:16px}
.modal table{width:100%}
.modal td{padding:8px;border-bottom:1px solid var(--border);vertical-align:top;max-width:none;white-space:normal;word-break:break-all}
.modal td:first-child{color:var(--muted);font-weight:bold;white-space:nowrap;width:150px}
.modal .close{position:absolute;top:16px;left:16px;background:none;border:none;color:var(--muted);cursor:pointer;font-size:20px}
.sql-box{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:monospace;font-size:12px;color:var(--yellow);direction:ltr;text-align:left;max-height:200px;overflow:auto;white-space:pre-wrap;margin-bottom:12px}
.schema-info{padding:16px;overflow-y:auto}
.schema-info table{margin-bottom:16px}
.schema-info th{position:static}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--green);color:#0f172a;padding:8px 20px;border-radius:8px;font-size:13px;font-weight:bold;z-index:200;opacity:0;transition:opacity .3s}
.toast.show{opacity:1}
.empty{text-align:center;padding:60px;color:var(--muted)}
.conn-status{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:6px}
.conn-ok{background:var(--green)}
.conn-err{background:var(--red)}
</style>
</head>
<body>
<header>
  <h1>&#128451; PostgreSQL Browser</h1>
  <span class="badge" id="dbName">...</span>
  <span class="conn-status" id="connStatus"></span>
  <div class="search-box"><input id="searchTables" placeholder="بحث في الجداول..." oninput="filterTables()"/></div>
  <button onclick="refreshAll()" style="padding:5px 14px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--accent);cursor:pointer;font-size:12px;font-weight:600">&#8635; تحديث</button>
</header>
<div class="layout">
  <div class="sidebar">
    <h3>الجداول</h3>
    <div id="tableList"></div>
  </div>
  <div class="main">
    <div class="toolbar">
      <span class="info" id="tableInfo">اختر جدولًا</span>
      <button onclick="showSchema()" id="btnSchema" style="display:none">&#128218; Schema</button>
      <button onclick="showSQL()" id="btnSQL" style="display:none">&#128196; SQL</button>
      <button onclick="exportCSV()" id="btnCSV" style="display:none">&#128202; CSV</button>
    </div>
    <div class="table-wrap" id="tableContent"><div class="empty">اختر جدولًا من القائمة الجانبية</div></div>
    <div class="pagination" id="pagination" style="display:none">
      <button onclick="prevPage()" id="btnPrev">&#8594; السابق</button>
      <span id="pageInfo"></span>
      <button onclick="nextPage()" id="btnNext">التالي &#8592;</button>
    </div>
  </div>
</div>
<div id="modalRoot"></div>
<div class="toast" id="toast"></div>
<script>
let tables=[],currentTable='',columns=[],rows=[],page=0,limit=50,totalRows=0,primaryKey='id',sortCol='',sortAsc=true;
const api=async(u,o)=>{const r=await fetch(u,o);const d=await r.json();if(!r.ok)throw new Error(d.message||'خطأ');return d;};
const toast=m=>{const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500);};
async function init(){
  try{
    const d=await api('/api/tables');
    tables=d.tables||[];
    document.getElementById('dbName').textContent=d.database||'PostgreSQL';
    document.getElementById('connStatus').className='conn-status conn-ok';
    renderTableList();
  }catch(e){
    document.getElementById('connStatus').className='conn-status conn-err';
    document.getElementById('tableList').innerHTML='<div style="padding:12px;color:var(--red);font-size:12px">'+e.message+'</div>';
  }
}
function renderTableList(filter=''){
  const list=document.getElementById('tableList');
  const f=filter.toLowerCase();
  list.innerHTML=tables.filter(t=>!f||t.name.toLowerCase().includes(f)).map(t=>
    '<button class="table-btn'+(currentTable===t.name?' active':'')+'" onclick="selectTable(\\''+t.name+'\\')"><span>'+t.name+'</span><span class="count">'+t.rowCount+'</span></button>'
  ).join('');
}
function filterTables(){renderTableList(document.getElementById('searchTables').value);}
async function selectTable(name){
  currentTable=name;page=0;sortCol='';sortAsc=true;
  document.getElementById('btnSchema').style.display='';
  document.getElementById('btnSQL').style.display='';
  document.getElementById('btnCSV').style.display='';
  renderTableList(document.getElementById('searchTables').value);
  await loadData();
}
async function loadData(){
  try{
    const d=await api('/api/table?name='+encodeURIComponent(currentTable)+'&limit='+limit+'&offset='+(page*limit)+(sortCol?'&sort='+encodeURIComponent(sortCol)+'&dir='+(sortAsc?'ASC':'DESC'):''));
    columns=d.columns||[];rows=d.rows||[];totalRows=d.totalRows||0;primaryKey=d.primaryKey||'id';
    document.getElementById('tableInfo').innerHTML='<b>'+currentTable+'</b> &mdash; '+totalRows+' سجل | الصفحة '+(page+1)+'/'+Math.ceil(totalRows/limit);
    document.getElementById('pagination').style.display=totalRows>limit?'flex':'none';
    document.getElementById('pageInfo').textContent=(page*limit+1)+'-'+Math.min((page+1)*limit,totalRows)+' من '+totalRows;
    document.getElementById('btnPrev').disabled=page<=0;
    document.getElementById('btnNext').disabled=(page+1)*limit>=totalRows;
    renderTable();
  }catch(e){document.getElementById('tableContent').innerHTML='<div class="empty" style="color:var(--red)">'+e.message+'</div>';}
}
function renderTable(){
  if(!columns.length){document.getElementById('tableContent').innerHTML='<div class="empty">لا توجد بيانات</div>';return;}
  let h='<table><thead><tr><th onclick="sortBy('__rownum__')">#</th>';
  columns.forEach(c=>{
    const arrow=sortCol===c.name?(sortAsc?' &#9650;':' &#9660;'):'';
    h+='<th onclick="sortBy(\\''+c.name+'\\')">'+c.name+' <span style="font-weight:normal;opacity:.4;font-size:10px">'+c.type+'</span>'+arrow+'</th>';
  });
  h+='</tr></thead><tbody>';
  rows.forEach((r,i)=>{
    h+='<tr onclick="showRow('+i+')" style="cursor:pointer"><td style="color:var(--muted)">'+(page*limit+i+1)+'</td>';
    columns.forEach(c=>{
      const v=r[c.name];
      const s=v===null?'<span style="color:#475569">NULL</span>':String(v).length>60?String(v).slice(0,60)+'...':escHtml(String(v));
      h+='<td>'+s+'</td>';
    });
    h+='</tr>';
  });
  h+='</tbody></table>';
  document.getElementById('tableContent').innerHTML=h;
}
function escHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sortBy(col){
  if(col==='__rownum__')return;
  if(sortCol===col)sortAsc=!sortAsc;else{sortCol=col;sortAsc=true;}
  loadData();
}
function prevPage(){if(page>0){page--;loadData();}}
function nextPage(){if((page+1)*limit<totalRows){page++;loadData();}}
function showRow(i){
  const r=rows[i];if(!r)return;
  let h='<table>';
  Object.entries(r).forEach(([k,v])=>{
    const val=v===null?'<span style="color:#475569">NULL</span>':String(v).length>500?'<div style="word-break:break-all;white-space:pre-wrap;max-height:300px;overflow:auto">'+escHtml(String(v))+'</div>':escHtml(String(v));
    h+='<tr><td>'+k+'</td><td>'+val+'</td></tr>';
  });
  h+='</table><div style="margin-top:12px;display:flex;gap:8px"><button onclick="deleteRow('+i+')" style="padding:6px 16px;border:1px solid var(--red);border-radius:8px;background:transparent;color:var(--red);cursor:pointer;font-size:12px">حذف</button><button onclick="closeModal()" style="padding:6px 16px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--muted);cursor:pointer;font-size:12px">إغلاق</button></div>';
  showModal('تفاصيل السجل #'+(page*limit+i+1),h);
}
async function deleteRow(i){
  const r=rows[i];if(!r||!confirm('هل أنت متأكد من حذف هذا السجل؟'))return;
  try{
    await api('/api/row?table='+encodeURIComponent(currentTable),{method:'DELETE',body:JSON.stringify({id:r[primaryKey],pk:primaryKey})});
    toast('تم الحذف');loadData();
  }catch(e){alert(e.message);}
}
async function showSchema(){
  try{
    const d=await api('/api/schema?name='+encodeURIComponent(currentTable));
    let h='<table><tr><th>العمود</th><th>النوع</th><th>قابل للـ NULL</th><th>القيمة الافتراضية</th></tr>';
    (d.columns||[]).forEach(c=>{
      h+='<tr><td style="font-weight:bold">'+c.name+'</td><td style="font-family:monospace">'+c.type+'</td><td>'+(c.nullable?'نعم':'لا')+'</td><td style="color:var(--muted)">'+(c.defaultValue||'—')+'</td></tr>';
    });
    h+='</table>';
    showModal('Schema: '+currentTable,h);
  }catch(e){alert(e.message);}
}
async function showSQL(){
  try{
    const d=await api('/api/ddl?name='+encodeURIComponent(currentTable));
    showModal('DDL: '+currentTable,'<div class="sql-box">'+escHtml(d.ddl||'')+'</div>');
  }catch(e){alert(e.message);}
}
function exportCSV(){
  if(!columns.length||!rows.length)return;
  let csv=columns.map(c=>'"'+c.name+'"').join(',')+'\\n';
  rows.forEach(r=>{csv+=columns.map(c=>{const v=r[c.name];return v===null?'':('"'+String(v).replace(/"/g,'""')+'"');}).join(',')+'\\n';});
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=currentTable+'.csv';a.click();
  toast('تم التصدير');
}
function showModal(title,body){
  document.getElementById('modalRoot').innerHTML='<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal"><h2>'+title+'</h2>'+body+'</div></div>';
}
function closeModal(){document.getElementById('modalRoot').innerHTML='';}
function refreshAll(){init();if(currentTable)loadData();}
init();
</script>
</body>
</html>`;

const query = (sql, params) => pool.query(sql, params);

const sendJSON = (res, data, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
};

const readBody = (req) => new Promise((resolve) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try { resolve(JSON.parse(body || "{}")); }
    catch { resolve({}); }
  });
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  try {
    if (path === "/" || path === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(HTML);
    }

    if (path === "/api/tables") {
      const dbResult = await query("SELECT current_database() AS db");
      const tablesResult = await query(
        `SELECT t.table_name, 
                COALESCE(pg_catalog.obj_description((quote_ident(t.table_schema)||'.'||quote_ident(t.table_name))::regclass), '') AS comment
         FROM information_schema.tables t
         WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         ORDER BY t.table_name`
      );
      const results = [];
      for (const row of tablesResult.rows) {
        const countResult = await query(`SELECT count(*)::text AS count FROM "${row.table_name}"`);
        results.push({ name: row.table_name, rowCount: Number(countResult.rows[0]?.count || 0), comment: row.comment });
      }
      return sendJSON(res, { success: true, database: dbResult.rows[0].db, tables: results });
    }

    if (path === "/api/table") {
      const table = url.searchParams.get("name") || "";
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return sendJSON(res, { success: false, message: "اسم الجدول غير صالح" }, 400);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 1000);
      const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
      const sort = url.searchParams.get("sort") || "";
      const dir = url.searchParams.get("dir") === "DESC" ? "DESC" : "ASC";

      const colsResult = await query(`SELECT column_name AS name, data_type AS type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
      const pkResult = await query(`SELECT a.attname AS pk FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary LIMIT 1`, [table]);
      const pk = pkResult.rows[0]?.pk || "id";
      const totalResult = await query(`SELECT count(*)::text AS count FROM "${table}"`);
      const totalRows = Number(totalResult.rows[0]?.count || 0);

      const sortClause = sort && colsResult.rows.some((c) => c.name === sort) ? `ORDER BY "${sort}" ${dir}` : "";
      const dataResult = await query(`SELECT * FROM "${table}" ${sortClause} LIMIT $1 OFFSET $2`, [limit, offset]);

      return sendJSON(res, {
        success: true,
        columns: colsResult.rows.map((c) => ({ name: c.name, type: c.type, nullable: c.is_nullable === "YES", defaultValue: c.column_default })),
        rows: dataResult.rows,
        totalRows,
        primaryKey: pk,
        limit,
        offset,
      });
    }

    if (path === "/api/schema") {
      const table = url.searchParams.get("name") || "";
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return sendJSON(res, { success: false, message: "اسم الجدول غير صالح" }, 400);
      const result = await query(
        `SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS "default", character_maximum_length AS maxlength
         FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]
      );
      return sendJSON(res, { success: true, columns: result.rows });
    }

    if (path === "/api/ddl") {
      const table = url.searchParams.get("name") || "";
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return sendJSON(res, { success: false, message: "اسم الجدول غير صالح" }, 400);
      const result = await query(`SELECT pg_get_tabledef('public', $1) AS ddl`, [table]).catch(() => null);
      if (result?.rows[0]?.ddl) return sendJSON(res, { success: true, ddl: result.rows[0].ddl });
      const cols = await query(`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
      let ddl = `CREATE TABLE "${table}" (\\n`;
      ddl += cols.rows.map((c) => `  "${c.column_name}" ${c.data_type}${c.is_nullable === "NO" ? " NOT NULL" : ""}${c.column_default ? " DEFAULT " + c.column_default : ""}`).join(",\\n");
      ddl += "\\n);";
      return sendJSON(res, { success: true, ddl });
    }

    if (path === "/api/row" && req.method === "DELETE") {
      const body = await readBody(req);
      const table = url.searchParams.get("table") || "";
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) return sendJSON(res, { success: false, message: "اسم الجدول غير صالح" }, 400);
      const pk = body.pk || "id";
      await query(`DELETE FROM "${table}" WHERE "${pk}" = $1`, [body.id]);
      return sendJSON(res, { success: true });
    }

    sendJSON(res, { success: false, message: "Not found" }, 404);
  } catch (err) {
    console.error("DB Browser error:", err.message);
    sendJSON(res, { success: false, message: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  \x1b[36m╔════════════════════════════════════════╗\x1b[0m`);
  console.log(`  \x1b[36m║\x1b[0m  \x1b[1m\x1b[37mPostgreSQL Browser\x1b[0m                   \x1b[36m║\x1b[0m`);
  console.log(`  \x1b[36m╠════════════════════════════════════════╣\x1b[0m`);
  console.log(`  \x1b[36m║\x1b[0m  \x1b[32m➜\x1b[0m  Local:   \x1b[4mhttp://localhost:${PORT}\x1b[0m   \x1b[36m║\x1b[0m`);
  console.log(`  \x1b[36m║\x1b[0m  \x1b[33m●\x1b[0m  Database: \x1b[37m${DATABASE_URL.split("@")[1] || DATABASE_URL}\x1b[0m  \x1b[36m║\x1b[0m`);
  console.log(`  \x1b[36m╚════════════════════════════════════════╝\x1b[0m\n`);
});
