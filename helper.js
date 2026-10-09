'use strict';
// No network API, storage, analytics, URL payloads or console output.
(() => {
 const $ = id => document.getElementById(id);
 const VERSION=1, LIFETIME=120000, ACK_TIMEOUT=5000;
 let session=null, coordinates=null, busy=false, sent=false, expiry, acknowledgement, heartbeat;
 const opener=window.opener;
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const validCode=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
 function localOrigin(value) {
  try {
   const u=new URL(value);
   if(u.origin!==value||u.username||u.password||!['http:','https:'].includes(u.protocol))return false;
   const host=u.hostname;
   if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='[::1]')return true;
   const ip=host.split('.').map(Number);
   if(!/^\d+\.\d+\.\d+\.\d+$/.test(host)||ip.some(n=>n>255))return false;
   return ip[0]===10||ip[0]===127||(ip[0]===192&&ip[1]===168)||(ip[0]===172&&ip[1]>=16&&ip[1]<=31);
  } catch {return false;}
 }
 function validCoordinates(c) {
  return object(c)&&typeof c.latitude==='number'&&Number.isFinite(c.latitude)&&Math.abs(c.latitude)<=90&&
   typeof c.longitude==='number'&&Number.isFinite(c.longitude)&&Math.abs(c.longitude)<=180&&
   typeof c.accuracy==='number'&&Number.isFinite(c.accuracy)&&c.accuracy>=0;
 }
 function send(type,extra={}) {
  if(!session)return false;
  try {opener.postMessage({type,version:VERSION,code:session.code,...extra},session.origin);return true;}catch{return false;}
 }
 function end(message) {
  clearTimeout(expiry);clearTimeout(acknowledgement);clearInterval(heartbeat);
  session=null;coordinates=null;busy=false;sent=false;
  $('consent').checked=false;$('consent').disabled=true;$('locate').disabled=true;$('return').disabled=true;
  $('preview').hidden=true;
  for(const id of ['latitude','longitude','accuracy'])$(id).textContent='';
  $('status').textContent=message;
 }
 window.addEventListener('message',event=>{
  const d=event.data;
  if(event.source!==opener||!localOrigin(event.origin)||!object(d)||d.version!==VERSION||!validCode(d.code))return;
  if(d.type==='mini-location-init') {
   if(!window.isSecureContext||!navigator.geolocation||!opener||location.search||location.hash)return;
   if(session){if(session.origin===event.origin&&session.code===d.code)send('mini-location-ready');return;}
   // A terminal session cannot be reused, even with a different code.
   if($('status').dataset.terminal==='true')return;
   session={origin:event.origin,code:d.code,lastContact:performance.now()};
   $('destination').textContent='Rückgabe ausschließlich an: '+event.origin;
   $('status').textContent='Portal verbunden. Bestätige die Abfrage und drücke auf „Standort jetzt ermitteln“.';
   $('consent').disabled=false;$('locate').disabled=false;
   clearTimeout(expiry);expiry=setTimeout(()=>{send('mini-location-error',{reason:'expired'});terminal('Die Sitzung ist abgelaufen. Starte die Standortübernahme erneut im Portal.');},LIFETIME);
   heartbeat=setInterval(()=>{
    if(!session)return;
    if(opener.closed||performance.now()-session.lastContact>15000){terminal('Verbindung zum Portal beendet oder unterbrochen. Bitte dort erneut starten oder manuell eingeben.');return;}
    send('mini-location-ping');
   },2000);
   send('mini-location-ready');return;
  }
  if(!session||event.origin!==session.origin||d.code!==session.code)return;
  if(d.type==='mini-location-pong')session.lastContact=performance.now();
  if(d.type==='mini-location-cancel')terminal('Verbindung beendet. Bitte im Portal eine neue Standortübernahme starten.');
  if(d.type==='mini-location-ack'&&sent)terminal('Koordinaten als Vorschau zurückgegeben. Bitte jetzt im Portal prüfen und dort ausdrücklich speichern.');
 });
 function terminal(message){$('status').dataset.terminal='true';end(message);}
 $('locate').onclick=()=>{
  if(!session||busy||sent)return;
  if(!$('consent').checked){$('status').textContent='Bitte zuerst der einmaligen Standortabfrage zustimmen.';return;}
  const active=session;busy=true;$('locate').disabled=true;$('consent').disabled=true;
  $('status').textContent='Der Browser ermittelt deinen Standort …';
  function failure(reason){if(session!==active)return;send('mini-location-error',{reason});terminal(reason==='denied'?'Standortfreigabe abgelehnt. Du kannst im Portal Koordinaten manuell eingeben.':'Standort konnte nicht ermittelt werden. Bitte im Portal erneut starten oder manuell eingeben.');}
  try {
   navigator.geolocation.getCurrentPosition(position=>{
    if(session!==active)return;
    const c={latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy};
    if(!validCoordinates(c)){failure('unavailable');return;}
    coordinates=c;busy=false;$('preview').hidden=false;
    $('latitude').textContent=String(c.latitude);$('longitude').textContent=String(c.longitude);$('accuracy').textContent=String(c.accuracy)+' m';
    $('return').disabled=false;$('status').textContent='Standort ermittelt. Prüfe die Vorschau und bestätige die Rückgabe.';
   },error=>failure(error.code===1?'denied':error.code===3?'timeout':'unavailable'),{enableHighAccuracy:false,timeout:12000,maximumAge:0});
  } catch {failure('unavailable');}
 };
 $('return').onclick=()=>{
  if(!session||!coordinates||sent)return;
  sent=true;$('return').disabled=true;
  if(!send('mini-location-result',{coordinates})){terminal('Rückgabe nicht möglich. Bitte im Portal erneut starten.');return;}
  $('status').textContent='Rückgabe wird vom Portal bestätigt …';
  acknowledgement=setTimeout(()=>terminal('Keine Bestätigung vom Portal erhalten. Prüfe dort die Vorschau; gespeichert wurde durch diese Seite nichts. Starte bei Bedarf erneut.'),ACK_TIMEOUT);
 };
 $('close').onclick=()=>{send('mini-location-error',{reason:'closed'});terminal('Fenster beendet.');window.close();};
 window.addEventListener('pagehide',()=>{send('mini-location-error',{reason:'closed'});terminal('Fenster beendet.');});
 if(!window.isSecureContext||!navigator.geolocation)terminal('Standortabfrage benötigt HTTPS und einen Browser mit Standortunterstützung. Bitte manuell im Portal eingeben.');
 else if(!opener||location.search||location.hash)terminal('Bitte diese Seite über „Standort automatisch ermitteln“ im lokalen Portal öffnen.');
 else expiry=setTimeout(()=>terminal('Keine Verbindung zum Portal. Bitte dort erneut starten oder Koordinaten manuell eingeben.'),15000);
})();
