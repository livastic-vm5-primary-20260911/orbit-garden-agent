import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8731);
const games = new Map();
const names = ['Nova', 'Drift', 'Echo', 'Pixel'];
const colors = ['#f8c15f','#69ddc4','#af9bff','#ff828f'];
const corners = [0, 24, 4, 20];
const TOTAL_ROUNDS = 9;
const TURN_MS = 12000;
const LIMIT = 10000;
const uid = () => crypto.randomBytes(12).toString('hex');
const codeId = () => crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const adjacent = (n) => {
  const x = n % 5, y = Math.floor(n / 5), out = [];
  if (x) out.push(n - 1);
  if (x < 4) out.push(n + 1);
  if (y) out.push(n - 5);
  if (y < 4) out.push(n + 5);
  return out;
};
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N}\- _]/gu, '').trim().slice(0, 18) || 'Explorer';
const finishScore = g => g.players.map(p => {
  const tiles = g.board.filter(t => t.owner === p.id);
  return { id:p.id, name:p.name, color:p.color, bot:p.bot, score: tiles.reduce((a,t) => a + 2 + t.level - 1 + (t.pos === 12 ? 3 : 0), 0), tiles:tiles.length, energy:p.energy };
}).sort((a,b) => b.score - a.score);
function record(g, message) {
  g.log.push({seq:g.log.length + 1, at:new Date().toISOString(), message});
  g.history.push(g.board.map(t => ({owner:t.owner,level:t.level,pos:t.pos,home:t.home})));
}
function newGame(name) {
  let code;
  do { code=codeId(); } while (games.has(code));
  const p = {id:uid(), token:uid(), name:cleanName(name), color:colors[0], energy:3, bot:false, seat:0};
  const g = {code, owner:p.id, players:[p], board:Array.from({length:25},(_,pos)=>({pos,owner:null,level:0,home:false})), status:'lobby', round:1, turn:0, turnsPlayed:0, maxTurns:0, createdAt:Date.now(), startedAt:null, endsAt:null, turnDeadline:null, log:[], history:[], winner:null};
  games.set(code,g);
  return {g,p};
}
function join(g,name,bot=false) {
  if(g.status!=='lobby') throw new Error('This match has already started');
  if(g.players.length>=4) throw new Error('The room is full');
  const seat=g.players.length;
  const p={id:uid(),token:uid(),name:cleanName(name || names[seat]),bot,color:colors[seat],energy:3,seat};
  g.players.push(p);
  return p;
}
function start(g,playerId,totalPlayers) {
  if(g.status!=='lobby') throw new Error('This match has already started');
  if(playerId!==g.owner) throw new Error('Only the host can start');
  const count=clamp(Number(totalPlayers)||2,2,4);
  if(g.players.length>count) throw new Error('Total players is smaller than joined players');
  while(g.players.length<count) join(g,names[g.players.length]+' Bot',true);
  for(const p of g.players) {
    const pos=corners[p.seat], tile=g.board[pos];
    tile.owner=p.id; tile.level=2; tile.home=true;
  }
  g.status='playing';g.startedAt=Date.now();g.maxTurns=TOTAL_ROUNDS*g.players.length;
  g.turnDeadline=Date.now()+TURN_MS;
  record(g,'Match started: '+g.players.map(p=>p.name).join(' / '));
}
function playable(g,p,action,pos) {
  if(g.status!=='playing') return false;
  if(g.players[g.turn].id !== p.id) return false;
  if(action==='harvest') return p.energy<7;
  if(!Number.isInteger(pos) || pos<0 || pos>24) return false;
  const t=g.board[pos], around=adjacent(pos), ownCount=around.filter(i=>g.board[i].owner===p.id).length;
  if(action==='claim') return !t.owner && ownCount>=1 && p.energy>=1;
  if(action==='fortify') return t.owner===p.id && t.level<3 && p.energy>=1;
  if(action==='raid') return !!t.owner && t.owner!==p.id && !t.home && ownCount>=t.level && p.energy>=2;
  return false;
}
function options(g,p) {
  const out=[];
  for(let pos=0;pos<25;pos++) for(const action of ['claim','raid','fortify']) if(playable(g,p,action,pos)) out.push({action,pos});
  if(playable(g,p,'harvest',null)) out.push({action:'harvest',pos:null});
  return out;
}
function scoreMove(g,p,move) {
  if(move.action==='harvest') return p.energy<=1 ? 10 : 0.8;
  const t=g.board[move.pos];
  if(move.action==='claim') {
    const neighbors=adjacent(move.pos).filter(x=>g.board[x].owner===p.id).length;
    return 10+(move.pos===12?9:0)+neighbors*.8+Math.random()*1.5;
  }
  if(move.action==='raid') return 12+(move.pos===12?8:0)+(t.level-1)*1.5+Math.random()*1.5;
  const threats=adjacent(move.pos).filter(x=>g.board[x].owner&&g.board[x].owner!==p.id).length;
  return 2+threats*2+(move.pos===12?2:0)+Math.random()*2;
}
function botMove(g,p) {
  const legal=options(g,p);
  if(!legal.length) return {action:'skip',pos:null};
  return [...legal].sort((a,b)=>scoreMove(g,p,b)-scoreMove(g,p,a))[0];
}
function next(g,message) {
  record(g,message);
  g.turnsPlayed++;
  if(g.turnsPlayed>=g.maxTurns) {
    g.status='finished';g.endsAt=Date.now();g.turnDeadline=null;
    const ranks=finishScore(g);g.winner=ranks[0];
    record(g,'Match over: '+ranks[0].name+' wins with '+ranks[0].score+' points');
    return;
  }
  g.turn=g.turnsPlayed%g.players.length;
  g.round=Math.floor(g.turnsPlayed/g.players.length)+1;
  g.turnDeadline=Date.now()+TURN_MS;
}
function apply(g,p,action,pos) {
  if(!playable(g,p,action,pos)) throw new Error('Illegal move. Read legalMoves from the state');
  if(action==='harvest') p.energy=clamp(p.energy+2,0,7);
  if(action==='claim') {g.board[pos].owner=p.id;g.board[pos].level=1;p.energy-=1;}
  if(action==='fortify') {g.board[pos].level++;p.energy-=1;}
  if(action==='raid') {g.board[pos].owner=p.id;g.board[pos].level=1;p.energy-=2;}
  p.energy=clamp(p.energy+1,0,7);
  next(g,p.name+' · '+action+(pos===null?'':' '+String(pos))+' · energy '+p.energy);
}
function tick(g) {
  if(g.status!=='playing') return;
  for(let i=0;i<g.players.length && g.status==='playing';i++) {
    const p=g.players[g.turn];
    if(!p.bot) break;
    const m=botMove(g,p);
    if(m.action==='skip') {p.energy=clamp(p.energy+1,0,7); next(g,p.name+' passed');}
    else apply(g,p,m.action,m.pos);
  }
  if(g.status==='playing' && Date.now()>=g.turnDeadline) {
    const p=g.players[g.turn];
    p.energy=clamp(p.energy+1,0,7);
    next(g,p.name+' timed out');
  }
}
function state(g,token) {
  tick(g);
  const me=g.players.find(p=>p.token===token);
  return {
    code:g.code,status:g.status,round:g.round,maxRounds:TOTAL_ROUNDS,
    turnPlayerId:g.status==='playing'?g.players[g.turn].id:null,
    turnDeadline:g.turnDeadline, now:Date.now(), startedAt:g.startedAt,
    players:g.players.map(p=>({id:p.id,name:p.name,color:p.color,energy:p.energy,bot:p.bot,seat:p.seat})),
    board:g.board, hostId:g.owner, meId:me?me.id:null,
    legalMoves:me?options(g,me):[], scores:finishScore(g),
    log:g.log,history:g.history,winner:g.winner,
    shareUrl:'/?room='+g.code
  };
}
function json(res,status,data) {
  const body=JSON.stringify(data);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,OPTIONS','X-Content-Type-Options':'nosniff'});
  res.end(body);
}
async function payload(req) {
  return await new Promise((resolve,reject)=>{
    let body='';
    req.on('data',x=>{body+=x;if(body.length>LIMIT){reject(new Error('Request too large'));req.destroy();}});
    req.on('end',()=>{try {resolve(body?JSON.parse(body):{});}catch(e){reject(new Error('Invalid JSON'));}});
    req.on('error',reject);
  });
}
const help = {
  name:'Orbit Garden',version:'1.0',rules:'Expand territory across a 5x5 garden in nine rounds. Claim adjacent neutral tiles, fortify tiles, raid weaker enemy tiles when enough friendly neighbors surround them, or harvest energy. Every tile scores two points, each level above one adds one, and the center adds three. Home bases cannot be raided. Highest total wins.',
  endpoints:[
    'POST /api/games body: {"name":"Human or Agent"} -> {code,playerId,token,state}',
    'POST /api/games/:code/join body: {"name":"Bot builder","type":"agent"} -> {playerId,token,state}',
    'POST /api/games/:code/start Authorization: Bearer TOKEN; body: {"totalPlayers":2} (host only, fills empty seats with bots)',
    'GET /api/games/:code Authorization: Bearer TOKEN -> state with legalMoves for authenticated seat',
    'POST /api/games/:code/move Authorization: Bearer TOKEN; body: {"action":"claim","pos":1} (use pos:null for harvest)',
    'GET /api/games/:code/replay -> {history,log}'
  ], timings:{rounds:9,secondsPerMove:12,maxMatchMinutes:7.2},security:'Tokens are scoped to one room and required to move. This is an unauthenticated public demo, not a custody application.'
};
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method==='OPTIONS') return json(res,204,{});
    const pathname=new URL(req.url,'http://localhost').pathname;
    const match=/^\/api\/games\/([A-F0-9]{6})(?:\/(join|start|move|replay))?$/.exec(pathname);
    const tok=String(req.headers.authorization||'').replace(/^Bearer /i,'');
    if(req.method==='GET'&&pathname==='/api/health') return json(res,200,{ok:true,service:'orbit-garden',games:games.size});
    if(req.method==='GET'&&pathname==='/api/docs') return json(res,200,help);
    if(req.method==='POST'&&pathname==='/api/games') {
      const b=await payload(req),{g,p}=newGame(b.name);
      return json(res,201,{code:g.code,playerId:p.id,token:p.token,state:state(g,p.token)});
    }
    if(match) {
      const g=games.get(match[1]),action=match[2];
      if(!g)return json(res,404,{error:'Room not found'});
      if(req.method==='GET'&&!action)return json(res,200,state(g,tok));
      if(req.method==='GET'&&action==='replay')return json(res,200,{history:g.history,log:g.log});
      if(req.method==='POST'&&action==='join') {
        const b=await payload(req),p=join(g,b.name,b.type==='bot');
        return json(res,201,{code:g.code,playerId:p.id,token:p.token,state:state(g,p.token)});
      }
      const p=g.players.find(p=>p.token===tok);
      if(!p)return json(res,401,{error:'Missing or invalid room token'});
      if(req.method==='POST'&&action==='start') {
        const b=await payload(req);start(g,p.id,b.totalPlayers);
        return json(res,200,state(g,tok));
      }
      if(req.method==='POST'&&action==='move') {
        const b=await payload(req);
        apply(g,p,b.action,b.pos??null);
        return json(res,200,state(g,tok));
      }
    }
    if(req.method==='GET'&&(pathname==='/'||pathname==='/index.html'||pathname==='/bot.js'||pathname==='/style.css'||pathname==='/app.js')) {
      const f=path.join(DIR,'public',pathname==='/bot.js'?'bot.js':pathname==='/style.css'?'style.css':pathname==='/app.js'?'app.js':'index.html');
      res.writeHead(200,{'Content-Type':pathname==='/bot.js'||pathname==='/app.js'?'application/javascript; charset=utf-8':pathname==='/style.css'?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return fs.createReadStream(f).pipe(res);
    }
    return json(res,404,{error:'Not found. GET /api/docs for API guidance'});
  } catch(e) {
    return json(res,e.message==='Illegal move. Read legalMoves from the state'?409:400,{error:e.message||'Bad request'});
  }
});
setInterval(()=>{for(const g of games.values())tick(g);for(const [id,g]of games)if(Date.now()-g.createdAt>8*60*60*1000)games.delete(id);},1000).unref();
server.listen(PORT,'0.0.0.0',()=>process.stdout.write('Orbit Garden listening on '+PORT+'\n'));
