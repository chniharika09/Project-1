require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { admin, auth } = require('./supabase');
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '40kb' }));
app.use('/api', rateLimit({ windowMs: 15*60*1000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
const allowed = new Set(process.env.TEACHER_EMAILS.split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
function fail(res, status, message) { return res.status(status).json({ error: message }); }
function validId(x) { return /^[1-9]\d*$/.test(String(x)); }
function validDate(x) { if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false; const d = new Date(x+'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === x; }
function clean(x,max=100) { return typeof x === 'string' ? x.trim().slice(0,max+1) : ''; }
async function query(promise) { const {data,error} = await promise; if (error) { console.error('Database error:',error.code); const e = new Error('Database request failed'); e.status = error.code === '23505' ? 409 : error.code === '23503' ? 400 : 503; throw e; } return data; }
app.get('/api/health', (_req,res) => res.json({ ok: true }));
app.use('/api', wrap(async (req,res,next) => {
 const token = /^Bearer (.+)$/i.exec(req.headers.authorization || '')?.[1];
 if (!token) return fail(res,401,'Please sign in');
 const {data,error} = await auth.auth.getUser(token);
 if (error || !data.user || !data.user.email) return fail(res,401,'Invalid or expired session');
 if (!allowed.has(data.user.email.toLowerCase())) return fail(res,403,'Teacher access only');
 req.user = data.user;
 next();
}));
app.get('/api/students',wrap(async (_req,res) => res.json(await query(admin.from('students').select('*').order('roll_no')))));
app.post('/api/students',wrap(async (req,res) => {
 const name=clean(req.body.name), roll_no=clean(req.body.roll_no,30), class_name=clean(req.body.class_name,60);
 if (!name || name.length>100 || !roll_no || roll_no.length>30 || !class_name || class_name.length>60) return fail(res,400,'Enter valid name, roll number and class');
 res.status(201).json(await query(admin.from('students').insert({name,roll_no,class_name}).select().single()));
}));
app.put('/api/students/:id',wrap(async(req,res)=>{
 if(!validId(req.params.id)) return fail(res,400,'Invalid student ID');
 const name=clean(req.body.name),roll_no=clean(req.body.roll_no,30),class_name=clean(req.body.class_name,60);
 if(!name||name.length>100||!roll_no||roll_no.length>30||!class_name||class_name.length>60) return fail(res,400,'Invalid student information');
 const rows=await query(admin.from('students').update({name,roll_no,class_name}).eq('id',req.params.id).select());
 if(!rows.length)return fail(res,404,'Student not found'); res.json(rows[0]);
}));
app.delete('/api/students/:id',wrap(async(req,res)=>{
 if(!validId(req.params.id))return fail(res,400,'Invalid student ID');
 const rows=await query(admin.from('students').delete().eq('id',req.params.id).select('id'));
 if(!rows.length)return fail(res,404,'Student not found'); res.json({ok:true});
}));
app.get('/api/subjects',wrap(async(_req,res)=>res.json(await query(admin.from('subjects').select('*').order('name')))));
app.post('/api/subjects',wrap(async(req,res)=>{
 const name=clean(req.body.name);if(!name||name.length>100)return fail(res,400,'Enter a valid subject');
 res.status(201).json(await query(admin.from('subjects').insert({name}).select().single()));
}));
app.delete('/api/subjects/:id',wrap(async(req,res)=>{
 if(!validId(req.params.id))return fail(res,400,'Invalid subject ID');
 const rows=await query(admin.from('subjects').delete().eq('id',req.params.id).select('id'));
 if(!rows.length)return fail(res,404,'Subject not found');res.json({ok:true});
}));
app.get('/api/attendance',wrap(async(req,res)=>{
 const {date,subject_id}=req.query;
 if(!validDate(date)||!validId(subject_id))return fail(res,400,'Valid date and subject required');
 res.json(await query(admin.from('attendance').select('student_id,status').eq('attendance_date',date).eq('subject_id',subject_id)));
}));
app.post('/api/attendance',wrap(async(req,res)=>{
 const {date,subject_id,records}=req.body;
 if(!validDate(date)||!validId(subject_id)||!Array.isArray(records)||records.length===0||records.length>500)return fail(res,400,'Invalid attendance data');
 const ids=records.map(r=>String(r.student_id));
 if(ids.some(x=>!validId(x))||new Set(ids).size!==ids.length||records.some(r=>!['Present','Absent'].includes(r.status)))return fail(res,400,'Invalid or duplicate student attendance');
 const students=await query(admin.from('students').select('id').in('id',ids));
 const subjects=await query(admin.from('subjects').select('id').eq('id',subject_id));
 if(students.length!==ids.length||subjects.length!==1)return fail(res,400,'Student or subject does not exist');
 const rows=records.map(r=>({student_id:r.student_id,subject_id,attendance_date:date,status:r.status,recorded_by:req.user.id}));
 await query(admin.from('attendance').upsert(rows,{onConflict:'student_id,subject_id,attendance_date'}));
 res.json({ok:true,count:rows.length});
}));
app.get('/api/report',wrap(async(req,res)=>{
 const {subject_id}=req.query;
 if(!validId(subject_id))return fail(res,400,'Select a subject');
 const students=await query(admin.from('students').select('id,name,roll_no,class_name').order('roll_no'));
 // Paginate so reports remain correct when there are over 1000 attendance rows.
 let all=[];
 for(let start=0;;start+=1000){
  const batch=await query(admin.from('attendance').select('student_id,status').eq('subject_id',subject_id).range(start,start+999));
  all.push(...batch);if(batch.length<1000)break;
 }
 const counts=new Map();for(const a of all){const c=counts.get(a.student_id)||{present:0,total:0};c.total++;if(a.status==='Present')c.present++;counts.set(a.student_id,c);}
 res.json(students.map(s=>{const c=counts.get(s.id)||{present:0,total:0};return {...s,...c,percentage:c.total?Math.round(c.present/c.total*10000)/100:null};}));
}));
app.use(express.static(path.join(__dirname,'..','frontend')));
app.use((err,req,res,next)=>{console.error(err.message);if(res.headersSent)return next(err);fail(res,err.status||500,err.status?'Request could not be completed':'Internal server error');});
const port=Number(process.env.PORT)||3000;
app.listen(port,()=>console.log(`Attendance app: http://localhost:${port}`));
