const jwt = require('jsonwebtoken');
const db = require('../supabase');
async function auth(req,res,next){
 try {
  const token=req.cookies?.session;
  if(!token) return res.status(401).json({error:'Please log in'});
  const data=jwt.verify(token,process.env.JWT_SECRET,{algorithms:['HS256']});
  const {data:user,error}=await db.from('staff').select('id,name,email,role').eq('id',data.id).single();
  if(error||!user) return res.status(401).json({error:'Account unavailable'});
  req.user=user;next();
 }catch(e){return res.status(401).json({error:'Session expired or invalid'});}
}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required'});next();}
module.exports={auth,admin};
