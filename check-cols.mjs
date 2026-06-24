import('pg').then(({Pool})=>{
  const p=new Pool({connectionString:'postgresql://postgres:postgres@localhost:5433/chat_app'});
  p.query("SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('msg','idreg')")
  .then(r=>{console.log(JSON.stringify(r.rows,null,2));p.end()})
  .catch(e=>{console.error(e.message);p.end()});
});
