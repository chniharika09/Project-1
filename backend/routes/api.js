const express=require('express'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const db=require('../supabase');const {auth,admin}=require('../middleware/auth');const router=express.Router();
const fail=(res,e)=>{console.error('Database operation failed:',e.message);return res.status(500).json({error:'Database operation failed'});};
const clean=s=>typeof s==='string'?s.trim():'';
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
router.get('/health',(_req,res)=>res.json({ok:true}));
router.post('/auth/login',async(req,res)=>{
 const email=clean(req.body.email).toLowerCase(),password=req.body.password;
 if(!email||typeof password!=='string')return res.status(400).json({error:'Enter email and password'});
 const {data:user,error}=await db.from('staff').select('*').eq('email',email).maybeSingle();if(error)return fail(res,error);
 if(!user||!(await bcrypt.compare(password,user.password_hash)))return res.status(401).json({error:'Invalid email or password'});
 const token=jwt.sign({id:user.id},process.env.JWT_SECRET,{expiresIn:'8h',algorithm:'HS256'});
 res.cookie('session',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000,path:'/'});
 res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role}});
});
router.post('/auth/logout',(_req,res)=>{res.clearCookie('session',{path:'/',sameSite:'strict',secure:process.env.NODE_ENV==='production'});res.json({ok:true});});
router.get('/me',auth,(req,res)=>res.json({user:req.user}));
router.get('/staff',auth,admin,async(req,res)=>{const {data,error}=await db.from('staff').select('id,name,email,role').order('name');if(error)return fail(res,error);res.json(data);});
router.post('/staff',auth,admin,async(req,res)=>{
 const name=clean(req.body.name),email=clean(req.body.email).toLowerCase(),password=req.body.password;
 if(name.length<2||!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length<12)return res.status(400).json({error:'Provide name, valid email and password of 12+ characters'});
 const {data,error}=await db.from('staff').insert({name,email,password_hash:await bcrypt.hash(password,12),role:'teacher'}).select('id,name,email,role').single();
 if(error)return res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'Email already exists':'Could not add teacher'});res.status(201).json(data);
});
router.get('/students',auth,async(req,res)=>{const {data,error}=await db.from('students').select('*').order('roll_number');if(error)return fail(res,error);res.json(data);});
router.post('/students',auth,admin,async(req,res)=>{
 const name=clean(req.body.name),roll_number=clean(req.body.roll_number),class_name=clean(req.body.class_name);
 if(!name||!roll_number||!class_name||[name,roll_number,class_name].some(x=>x.length>100))return res.status(400).json({error:'Name, roll number and class are required (max 100 characters)'});
 const {data,error}=await db.from('students').insert({name,roll_number,class_name}).select().single();if(error)return res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'Roll number already exists':'Could not save student'});res.status(201).json(data);
});
router.delete('/students/:id',auth,admin,async(req,res)=>{if(!uuid(req.params.id))return res.status(400).json({error:'Invalid ID'});const {error}=await db.from('students').delete().eq('id',req.params.id);if(error)return fail(res,error);res.json({ok:true});});
router.get('/subjects',auth,async(req,res)=>{const {data,error}=await db.from('subjects').select('*').order('name');if(error)return fail(res,error);res.json(data);});
router.post('/subjects',auth,admin,async(req,res)=>{
 const name=clean(req.body.name),code=clean(req.body.code).toUpperCase();if(!name||!code||name.length>100||code.length>30)return res.status(400).json({error:'Subject name and code are required'});
 const {data,error}=await db.from('subjects').insert({name,code}).select().single();if(error)return res.status(error.code==='23505'?409:500).json({error:error.code==='23505'?'Subject code already exists':'Could not add subject'});res.status(201).json(data);
});
router.delete('/subjects/:id',auth,admin,async(req,res)=>{if(!uuid(req.params.id))return res.status(400).json({error:'Invalid ID'});const {error}=await db.from('subjects').delete().eq('id',req.params.id);if(error)return fail(res,error);res.json({ok:true});});
router.get('/attendance',auth,async(req,res)=>{
 const {date,subject_id}=req.query;if(!validDate(date)||!uuid(subject_id))return res.status(400).json({error:'Choose a valid date and subject'});
 const {data,error}=await db.from('attendance').select('student_id,status').eq('date',date).eq('subject_id',subject_id);if(error)return fail(res,error);res.json(data);
});
router.post('/attendance',auth,async(req,res)=>{
 const {date,subject_id,records}=req.body;
 if(!validDate(date)||!uuid(subject_id)||!Array.isArray(records)||!records.length||records.length>500||records.some(r=>!uuid(r.student_id)||!['present','absent'].includes(r.status)))return res.status(400).json({error:'Invalid attendance submission'});
 if(new Set(records.map(r=>r.student_id)).size!==records.length)return res.status(400).json({error:'Duplicate students in submission'});
 const {data:subject,error:se}=await db.from('subjects').select('id').eq('id',subject_id).maybeSingle();if(se)return fail(res,se);if(!subject)return res.status(404).json({error:'Subject not found'});
 const {data:students,error:ste}=await db.from('students').select('id').in('id',records.map(r=>r.student_id));if(ste)return fail(res,ste);if(students.length!==records.length)return res.status(400).json({error:'One or more students do not exist'});
 const {error}=await db.from('attendance').upsert(records.map(r=>({date,subject_id,student_id:r.student_id,status:r.status,marked_by:req.user.id})),{onConflict:'student_id,subject_id,date'});if(error)return fail(res,error);res.json({saved:records.length});
});
router.get('/reports',auth,async(req,res)=>{
 const {subject_id,from,to}=req.query;if(!uuid(subject_id)||!validDate(from)||!validDate(to)||from>to)return res.status(400).json({error:'Choose subject and valid date range'});
 const {data,error}=await db.from('attendance').select('student_id,status').eq('subject_id',subject_id).gte('date',from).lte('date',to).limit(100000);
 if(error)return fail(res,error);if(data.length===100000)return res.status(400).json({error:'Too many records; choose a shorter date range'});
 const {data:students,error:se}=await db.from('students').select('id,name,roll_number,class_name').order('roll_number');if(se)return fail(res,se);
 const counts=new Map(students.map(s=>[s.id,{...s,present:0,total:0}]));for(const r of data){const x=counts.get(r.student_id);if(x){x.total++;if(r.status==='present')x.present++;}}
 res.json([...counts.values()].map(x=>({...x,percentage:x.total?Math.round(x.present/x.total*10000)/100:null})));
});
module.exports=router;
