// Isolated synthetic browser-test API. Never used by production start scripts.
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../backend/src/app.js';
import { migrate } from '../backend/src/migrations.js';
import { seed } from '../backend/src/seed.js';
const db=new PGlite();
const query=db.query.bind(db);
db.query=(sql,values)=>!values&&sql.includes(';')?db.exec(sql).then(results=>results.at(-1)):query(sql,values);
await migrate(db);await seed(db,'E2E-only-password-2026');
for(let index=1;index<=11;index++) await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date) VALUES($1,$2,'Analyst','Test','Melbourne','2026-10-19')",[`PAGE-${String(index).padStart(3,'0')}`,`Paging Person ${index}`]);
await db.query("INSERT INTO employees(employee_number,full_name,job_title,department,location,start_date,lifecycle_status) VALUES('OFF-ACTIVE-001','Active Offboarding Employee','Business Analyst','Consulting','Melbourne','2026-10-19','Active')");
const server=createApp(()=>db.query('SELECT 1'),db,{origin:'http://127.0.0.1:5175',limiter:false}).listen(3101,'127.0.0.1',()=>console.log('Isolated browser-test API ready'));
function stop(){server.close(async()=>{await db.close();process.exit(0);});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
