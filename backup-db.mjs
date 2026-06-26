import('pg').then(async ({Pool}) => {
  const p = new Pool({connectionString: 'postgresql://postgres:postgres@localhost:5433/chat_app'});
  const client = await p.connect();
  
  // Get all tables
  const tablesRes = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' 
    ORDER BY table_name
  `);
  
  let sql = `-- Database Backup: chat_app\n-- Date: ${new Date().toISOString()}\n-- Host: localhost:5433\n\n`;
  sql += `SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n\n`;
  
  for (const row of tablesRes.rows) {
    const table = row.table_name;
    
    // Get columns
    const colsRes = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1 
      ORDER BY ordinal_position
    `, [table]);
    
    // Get constraints (PK)
    const pkRes = await client.query(`
      SELECT a.attname FROM pg_index i 
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) 
      WHERE i.indrelid = $1::regclass AND i.indisprimary
    `, [table]);
    const pkCols = pkRes.rows.map(r => r.attname);
    
    // Get sequences
    const seqRes = await client.query(`
      SELECT pg_get_serial_sequence($1, column_name) as seq, column_name
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1 
      AND column_default LIKE 'nextval%'
    `, [table]);
    
    // Get indexes
    const idxRes = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes 
      WHERE tablename = $1 AND schemaname = 'public' AND indexname NOT LIKE '%_pkey'
    `, [table]);
    
    // Get triggers
    const trigRes = await client.query(`
      SELECT trigger_name, event_manipulation, action_statement 
      FROM information_schema.triggers 
      WHERE event_object_table = $1 AND event_object_schema = 'public'
    `, [table]);
    
    sql += `\n-- Table: ${table}\n`;
    sql += `DROP TABLE IF EXISTS "${table}" CASCADE;\n`;
    sql += `CREATE TABLE "${table}" (\n`;
    
    const colDefs = colsRes.rows.map(c => {
      let def = `  "${c.column_name}" ${c.data_type}`;
      if (c.is_nullable === 'NO') def += ' NOT NULL';
      if (c.column_default) def += ` DEFAULT ${c.column_default}`;
      return def;
    });
    sql += colDefs.join(',\n') + '\n);\n\n';
    
    // Sequences
    for (const s of seqRes.rows) {
      if (s.seq) {
        sql += `CREATE SEQUENCE IF NOT EXISTS ${s.seq};\n`;
        sql += `ALTER TABLE "${table}" ALTER COLUMN "${s.column_name}" SET DEFAULT nextval('${s.seq}');\n`;
        // Set sequence ownership
        sql += `ALTER SEQUENCE ${s.seq} OWNED BY "${table}"."${s.column_name}";\n`;
      }
    }
    if (seqRes.rows.length > 0) sql += '\n';
    
    // Primary key
    if (pkCols.length > 0) {
      sql += `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_pkey" PRIMARY KEY (${pkCols.map(c => `"${c}"`).join(', ')});\n\n`;
    }
    
    // Indexes
    for (const idx of idxRes.rows) {
      sql += `${idx.indexdef};\n`;
    }
    if (idxRes.rows.length > 0) sql += '\n';
  }
  
  // Foreign keys
  const fkRes = await client.query(`
    SELECT
      tc.table_name, kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `);
  
  if (fkRes.rows.length > 0) {
    sql += `\n-- Foreign Keys\n`;
    for (const fk of fkRes.rows) {
      sql += `ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}" ("${fk.foreign_column_name}");\n`;
    }
    sql += '\n';
  }
  
  // Data
  for (const row of tablesRes.rows) {
    const table = row.table_name;
    const dataRes = await client.query(`SELECT * FROM "${table}"`);
    
    if (dataRes.rows.length > 0) {
      sql += `\n-- Data: ${table} (${dataRes.rows.length} rows)\n`;
      
      for (const r of dataRes.rows) {
        const cols = Object.keys(r);
        const vals = cols.map(c => {
          const v = r[c];
          if (v === null) return 'NULL';
          if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
          if (typeof v === 'boolean') return v ? 'true' : 'false';
          if (v instanceof Date) return `'${v.toISOString()}'`;
          if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
          return String(v);
        });
        sql += `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')});\n`;
      }
      sql += '\n';
    }
  }
  
  // Sequences restart
  sql += `\n-- Restart sequences\n`;
  for (const row of tablesRes.rows) {
    const seqRes = await client.query(`
      SELECT pg_get_serial_sequence($1, column_name) as seq
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = $1 
      AND column_default LIKE 'nextval%'
    `, [row.table_name]);
    for (const s of seqRes.rows) {
      if (s.seq) {
        sql += `SELECT setval('${s.seq}', COALESCE((SELECT MAX(id) FROM "${row.table_name}"), 1));\n`;
      }
    }
  }
  
  sql += `\n-- End of backup\n`;
  
  const fs = await import('fs');
  fs.writeFileSync('database_backup.sql', sql, 'utf8');
  
  const stats = fs.statSync('database_backup.sql');
  console.log(`Backup created: database_backup.sql (${(stats.size / 1024).toFixed(1)} KB)`);
  console.log(`Tables: ${tablesRes.rows.length}`);
  
  let totalRows = 0;
  for (const row of tablesRes.rows) {
    const count = await client.query(`SELECT count(*)::int as c FROM "${row.table_name}"`);
    totalRows += count.rows[0].c;
  }
  console.log(`Total rows: ${totalRows}`);
  
  client.release();
  await p.end();
}).catch(e => { console.error('Error:', e.message); process.exit(1); });
