/* Orbit Garden agent example. Node.js 20+.
   node public/bot.js NEW
   node public/bot.js ROOMCODE
   ORBIT_SERVER=https://your-tunnel.trycloudflare.com node public/bot.js ROOMCODE
*/
'use strict';
const base=(process.env.ORBIT_SERVER||'http://127.0.0.1:8731').replace(/\/$/,'');
const roomArg=(process.argv[2]||'NEW').toUpperCase();
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
async function api(path,method='GET',data,token){
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined});
  const result=await r.json();
  if(!r.ok)throw new Error(result.error||'API error '+r.status);
  return result;
}
async function main(){
  let c=roomArg, auth, token;
  if(c==='NEW'){
    auth=await api('/api/games','POST',{name:'Sample Agent'});
    c=auth.code;token=auth.token;
    await api('/api/games/'+c+'/start','POST',{totalPlayers:2},token);
    console.log('Started room '+c+' — open '+base+'/?room='+c);
  }else{
    auth=await api('/api/games/'+c+'/join','POST',{name:'Sample Agent',type:'agent'});
    token=auth.token;
    console.log('Joined room '+c+'. Ask the host to start: '+base+'/?room='+c);
  }
  let lastMoves=0;
  for(let i=0;i<1000;i++){
    const state=await api('/api/games/'+c,'GET',null,token);
    if(state.status==='finished'){
      console.log('Match finished:',state.scores.map(p=>p.name+': '+p.score).join(', '));
      return;
    }
    if(state.status==='playing'&&state.turnPlayerId===auth.playerId){
      const legal=state.legalMoves;
      const board=state.board;
      const choice=legal.map(m=>{
        const t=m.pos===null?null:board[m.pos];
        let score=m.action==='harvest'?1:m.action==='claim'?6:m.action==='raid'?7:2;
        if(m.pos===12)score+=6;
        if(m.action==='fortify'&&t)score+=t.level===1?2:0;
        return {m,score:score+Math.random()};
      }).sort((a,b)=>b.score-a.score)[0];
      if(choice){
        await api('/api/games/'+c+'/move','POST',choice.m,token);
        console.log('Round '+state.round+': '+choice.m.action+' '+choice.m.pos);
        lastMoves++;
      }
    }
    await sleep(350);
  }
  throw new Error('Polling exceeded safety budget');
}
main().catch(err=>{console.error('Sample bot:',err.message);process.exitCode=1;});
