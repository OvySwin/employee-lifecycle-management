import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../src/migrations.js';
it('persists migrated data across embedded PostgreSQL restart',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'elm-test-'));
  let db;
  try {
    db=new PGlite(directory);
    const query=db.query.bind(db);
    const adapter={ query:(sql,values)=>!values && sql.includes(';') ? db.exec(sql).then(results=>results.at(-1)) : query(sql,values) };
    await migrate(adapter);
    await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date) VALUES('PERSIST','Persistent Demo','Analyst','IT','Melbourne','2026-10-19')");
    await db.close(); db=new PGlite(directory);
    expect((await db.query("SELECT full_name FROM employees WHERE employee_number='PERSIST'")).rows[0].full_name).toBe('Persistent Demo');
  } finally { await db?.close(); await rm(directory,{recursive:true,force:true}); }
},30000);
