// build_geo.js — Extract Kano LGA boundaries (geoBoundaries gbOpen ADM2),
// generate wards (raster Voronoi + Lloyd relaxation) and polling units.
// Output: data/geo.json used by the server & map engine.
'use strict';
const fs = require('fs');

// ---------- seeded RNG ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const rng = mulberry32(20270044);
const ri=(a,b)=>a+Math.floor(rng()*(b-a+1));

// ---------- geometry helpers ----------
function ptInPoly(pt, poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if(((yi>pt[1])!==(yj>pt[1]))&&(pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi))inside=!inside;}return inside;}
function polyArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=p[j][0]*p[i][1]-p[i][0]*p[j][1];return Math.abs(a)/2;}
function centroid(p){let cx=0,cy=0,a=0;for(let i=0,j=p.length-1;i<p.length;j=i++){const f=p[j][0]*p[i][1]-p[i][0]*p[j][1];cx+=(p[j][0]+p[i][0])*f;cy+=(p[j][1]+p[i][1])*f;a+=f;}a/=2;if(a===0)return p[0];return[cx/(6*a),cy/(6*a)];}
// Douglas-Peucker
function dp(pts,eps){if(pts.length<3)return pts;const keep=new Array(pts.length).fill(false);keep[0]=keep[pts.length-1]=true;const stack=[[0,pts.length-1]];
  const d2p=(p,a,b)=>{const[ax,ay]=a,[bx,by]=b;const l2=(bx-ax)**2+(by-ay)**2;if(l2===0)return Math.hypot(p[0]-ax,p[1]-ay);const t=Math.max(0,Math.min(1,((p[0]-ax)*(bx-ax)+(p[1]-ay)*(by-ay))/l2));return Math.hypot(p[0]-(ax+t*(bx-ax)),p[1]-(ay+t*(by-ay)));};
  while(stack.length){const[a,b]=stack.pop();let d=0,idx=-1;for(let i=a+1;i<b;i++){const dd=d2p(pts[i],pts[a],pts[b]);if(dd>d){d=dd;idx=i;}}if(d>eps){keep[idx]=true;stack.push([a,idx],[idx,b]);}}
  return pts.filter((_,i)=>keep[i]);
}
// Chaikin smoothing (closed)
function chaikin(poly,it=1){let p=poly;for(let k=0;k<it;k++){const q=[];for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];q.push([a[0]*0.75+b[0]*0.25,a[1]*0.75+b[1]*0.25]);q.push([a[0]*0.25+b[0]*0.75,a[1]*0.25+b[1]*0.75]);}p=q;}return p;}
// Marching squares: extract contour(s) of binary mask on grid cells; returns array of rings (cell coords)
function marchingSquares(mask,w,h){
  const segs=[];
  const P=(x,y)=>x+','+y;
  for(let y=0;y<h-1;y++)for(let x=0;x<w-1;x++){
    const idx=(mask[y][x]?1:0)|(mask[y][x+1]?2:0)|(mask[y+1][x+1]?4:0)|(mask[y+1][x]?8:0);
    if(idx===0||idx===15)continue;
    const T=[x+0.5,y],B=[x+0.5,y+1],L=[x,y+0.5],R=[x+1,y+0.5];
    const conns={1:[[L,B]],2:[[B,R]],3:[[L,R]],4:[[T,R]],5:[[L,T],[B,R]],6:[[T,B]],7:[[L,T]],8:[[T,L]],9:[[T,B]],10:[[T,L],[R,B]],11:[[T,R]],12:[[L,R]],13:[[T,B]],14:[[T,L]]};
    const cc=conns[idx];if(!cc)continue;
    for(const [a,b] of cc)segs.push([a,b]);
  }
  // stitch segments into rings
  const next={};
  for(const [a,b] of segs){
    const ka=P(a[0],a[1]),kb=P(b[0],b[1]);
    (next[ka]=next[ka]||[]).push(b);(next[kb]=next[kb]||[]).push(a);
  }
  const seen=new Set();const rings=[];
  for(const k in next){
    if(seen.has(k))continue;
    const start=k;const ring=[];let cur=start;let guard=0;
    while(guard++<20000){
      seen.add(cur);const [x,y]=cur.split(',').map(Number);ring.push([x,y]);
      const nbrs=next[cur];if(!nbrs)break;
      let nx=null;
      for(const nb of nbrs){const nk=P(nb[0],nb[1]);if(nk===start&&ring.length>2){nx=nk;break;}if(!seen.has(nk)){nx=nk;break;}}
      if(nx===null)break;cur=nx;if(cur===start)break;
    }
    if(ring.length>=4)rings.push(ring);
  }
  return rings;
}

// ---------- projection ----------
const LAT0=11.9,LON0=8.4;
const KX=111320*Math.cos(LAT0*Math.PI/180),KY=110540;
const proj=([lon,lat])=>[(lon-LON0)*KX,(lat-LAT0)*KY];
const invProj=([x,y])=>[x/KX+LON0,y/KY+LAT0];

// ---------- load & filter Kano ----------
const src=JSON.parse(fs.readFileSync(process.argv[2]||'data/nga_adm2_src.geojson','utf8'));
const KANO_NAMES={
  'Ajingi':'Ajingi','Albasu':'Albasu','Bagwai':'Bagwai','Bebeji':'Bebeji','Bichi':'Bichi','Bunkure':'Bunkure',
  'Dala':'Dala','Dambatta':'Dambatta','Dawakin Kudu':'Dawakin Kudu','Dawakin Tofa':'Dawakin Tofa','Doguwa':'Doguwa',
  'Fagge':'Fagge','Gabasawa':'Gabasawa','Garko':'Garko','Garun Malam':'Garun Mallam','Gaya':'Gaya','Gezawa':'Gezawa',
  'Gwale':'Gwale','Gwarzo':'Gwarzo','Kabo':'Kabo','Kano Municipal':'Kano Municipal','Karaye':'Karaye','Kibiya':'Kibiya',
  'Kiru':'Kiru','Kumbotso':'Kumbotso','Kunchi':'Kunchi','Kura':'Kura','Madobi':'Madobi','Makoda':'Makoda',
  'Minjibir':'Minjibir','Nassarawa':'Nasarawa','Rano':'Rano','Rimin Gado':'Rimin Gado','Rogo':'Rogo','Shanono':'Shanono',
  'Sumaila':'Sumaila','Takai':'Takai','Tarauni':'Tarauni','Tofa':'Tofa','Tsanyawa':'Tsanyawa','Tudun Wada':'Tudun Wada',
  'Ungogo':'Ungogo','Warawa':'Warawa','Wudil':'Wudil'
};
const SENATORIAL={
  'Kano Central':['Dala','Fagge','Gwale','Kano Municipal','Kumbotso','Nasarawa','Tarauni','Ungogo'],
  'Kano North':['Bagwai','Bichi','Dambatta','Dawakin Tofa','Gabasawa','Gezawa','Gwarzo','Kabo','Karaye','Kunchi','Makoda','Minjibir','Rimin Gado','Shanono','Tofa','Tsanyawa'],
  'Kano South':['Ajingi','Albasu','Bebeji','Bunkure','Dawakin Kudu','Doguwa','Garko','Garun Mallam','Gaya','Kibiya','Kiru','Kura','Madobi','Rano','Rogo','Sumaila','Takai','Tudun Wada','Warawa','Wudil']
};
const senOf={};for(const[sd,lgs]of Object.entries(SENATORIAL))for(const l of lgs)senOf[l]=sd;

const feats=src.features.filter(f=>KANO_NAMES[f.properties.shapeName]);
console.log('Kano features:',feats.length);

// project + simplify LGA polygons
const lgasRaw=feats.map(f=>{
  const name=KANO_NAMES[f.properties.shapeName];
  let poly=[];
  const geom=f.geometry;
  const rings=geom.type==='Polygon'?geom.coordinates:geom.coordinates.flat(1);
  // take largest ring
  let best=rings[0];
  for(const p of rings){if(polyArea(p.map(proj))>polyArea(best.map(proj)))best=p;}
  poly=best.map(proj);
  poly=dp(poly,120); // ~120m tolerance
  if(poly.length>80)poly=dp(poly,320);
  poly=chaikin(poly,1);
  poly=dp(poly,80);
  return {name,senatorial:senOf[name],poly};
});
console.log('LGA pts:',lgasRaw.map(l=>l.poly.length).join(','));

// bounds & normalize
let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
for(const l of lgasRaw)for(const[x,y]of l.poly){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
console.log('bounds m:',minX.toFixed(0),minY.toFixed(0),maxX.toFixed(0),maxY.toFixed(0));
const S=95;const sy=(maxY-minY)/(maxX-minX);
const NORM=(p)=>[((p[0]-minX)/(maxX-minX))*S,((p[1]-minY)/(maxY-minY))*S*sy];

// ---------- ward generation ----------
const CELL=0.55; // grid cell in normalized units
function genWards(lga,lgaIdx){
  const poly=lga.poly.map(NORM);
  const [cx,cy]=centroid(poly);
  const bb={minX:Math.min(...poly.map(p=>p[0])),minY:Math.min(...poly.map(p=>p[1])),maxX:Math.max(...poly.map(p=>p[0])),maxY:Math.max(...poly.map(p=>p[1]))};
  const w=Math.max(4,Math.ceil((bb.maxX-bb.minX)/CELL)),h=Math.max(4,Math.ceil((bb.maxY-bb.minY)/CELL));
  const mask=[];for(let y=0;y<h;y++){mask.push([]);for(let x=0;x<w;x++){const px=bb.minX+(x+0.5)*(bb.maxX-bb.minX)/w,py=bb.minY+(y+0.5)*(bb.maxY-bb.minY)/h;mask[y].push(ptInPoly([px,py],poly));}}
  const cells=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y][x])cells.push([x,y,bb.minX+(x+0.5)*(bb.maxX-bb.minX)/w,bb.minY+(y+0.5)*(bb.maxY-bb.minY)/h]);
  if(cells.length===0)return [];
  const k=Math.min(14,Math.max(4,Math.round(cells.length/15))); // wards ~ proportional to area, capped (real Kano ~11/LGA)
  // seeds: farthest-point-ish init
  const seeds=[];let s0=cells[Math.floor(rng()*cells.length)];seeds.push(s0);
  while(seeds.length<k){let best=null,bd=-1;for(const c of cells){let d=Infinity;for(const s of seeds)d=Math.min(d,(c[2]-s[2])**2+(c[3]-s[3])**2);if(d>bd){bd=d;best=c;}}seeds.push(best);}
  let seedPos=seeds.map(s=>[s[2],s[3]]);
  for(let it=0;it<8;it++){
    const sums=seedPos.map(()=>[0,0,0]);
    for(const c of cells){let bi=0,bd=Infinity;for(let i=0;i<k;i++){const d=(c[2]-seedPos[i][0])**2+(c[3]-seedPos[i][1])**2;if(d<bd){bd=d;bi=i;}}sums[bi][0]+=c[2];sums[bi][1]+=c[3];sums[bi][2]++;}
    for(let i=0;i<k;i++)if(sums[i][2]>0)seedPos[i]=[sums[i][0]/sums[i][2],sums[i][1]/sums[i][2]];
  }
  // assign cells
  const assign=Array(k).fill().map(()=>[]);
  for(const c of cells){let bi=0,bd=Infinity;for(let i=0;i<k;i++){const d=(c[2]-seedPos[i][0])**2+(c[3]-seedPos[i][1])**2;if(d<bd){bd=d;bi=i;}}assign[bi].push(c);}
  const wards=[];
  const wardNames=['Arewa','Kudu','Gabas','Yamma','Tsakiya','Sabon Gari','Tsohuwar','Rijiyar','Kofar','Unguwar','Dakata','Gurin','Farawa','Badawa','Dandago','Kurna','Ja\'en','Dadin Kowa','Tudun','Danbazau','Giginyu','Dakata','Hotoro','Zango','Darmanawa','Rimin','Fagwalawa','Malamai','Garin','Filin','Kwanar','Dawaki','Rafin','Wailari','Gandu','Kudu','Dorayi','Dala','Mabuga','Bachirawa','Takalmawa','Mandawari','Jakara','Yalwa','Chiranchi','Dan Agundi','Dandinshe','Jigirya','Bachirawa','Sharada','Zangon','Dakatsalle'];
  for(let i=0;i<k;i++){
    const cs=assign[i];if(cs.length<2)continue;
    // build binary mask for this ward at cell resolution for marching squares
    const cx0=Math.min(...cs.map(c=>c[0])),cy0=Math.min(...cs.map(c=>c[1]));
    const ww=Math.max(...cs.map(c=>c[0]))-cx0+2,hh=Math.max(...cs.map(c=>c[1]))-cy0+2;
    const m=Array(hh).fill().map(()=>Array(ww).fill(false));
    for(const c of cs)m[c[1]-cy0+1][c[0]-cx0+1]=true;
    const rings=marchingSquares(m,ww,hh).map(r=>r.map(([x,y])=>[x+cx0-1,y+cy0-1]));
    if(!rings.length)continue;
    // scale cell coords to normalized units
    const scaleX=(bb.maxX-bb.minX)/w,scaleY=(bb.maxY-bb.minY)/h;
    const ring=rings[0].map(([x,y])=>[bb.minX+x*scaleX,bb.minY+y*scaleY]);
    let r2=chaikin(ring,1);
    r2=dp(r2,0.06);
    if(r2.length<4)continue;
    const cc2=centroid(r2);
    const nm=(wardNames[(lgaIdx*7+i*3)%wardNames.length]+' '+(wardNames[(lgaIdx*13+i*5+1)%wardNames.length])).trim();
    wards.push({name:nm+` Ward`,poly:r2.map(p=>[+p[0].toFixed(2),+p[1].toFixed(2)]),centroid:[+cc2[0].toFixed(2),+cc2[1].toFixed(2)]});
  }
  return wards;
}

// ---------- build final ----------
const lgas=[];
let puCounter=0;
for(let li=0;li<lgasRaw.length;li++){
  const l=lgasRaw[li];
  const wards=genWards(l,li);
  const polyN=l.poly.map(NORM).map(p=>[+p[0].toFixed(2),+p[1].toFixed(2)]);
  const cen=centroid(polyN);
  const ll=invProj([(cen[0]/S)*(maxX-minX)+minX,(cen[1]/(S*sy))*(maxY-minY)+minY]);
  const pus=[];
  const puTemplates=[
    (w)=>({name:`${w} Primary School`}),
    (w)=>({name:`${w} Islamiyya Centre`}),
    (w)=>({name:`${w} Market Square`}),
    (w)=>({name:`${w} Health Post`}),
    (w)=>({name:`${w} Village Hall`}),
    (w)=>({name:`${w} Open Space`}),
    (w)=>({name:`${w} Central Mosque`}),
    (w)=>({name:`${w} Community Centre`}),
  ];
  for(let wi=0;wi<wards.length;wi++){
    const w=wards[wi];
    const n=2+((li*3+wi)%3); // 2-4 PUs per ward
    for(let p=0;p<n;p++){
      puCounter++;
      const t=puTemplates[(li*5+wi*7+p)%puTemplates.length](w.name.replace(' Ward',''));
      const jx=(rng()-0.5)*0.5,jy=(rng()-0.5)*0.5;
      const px=Math.min(Math.max(w.centroid[0]+jx,Math.min(...w.poly.map(q=>q[0]))+0.1),Math.max(...w.poly.map(q=>q[0]))-0.1);
      const py=Math.min(Math.max(w.centroid[1]+jy,Math.min(...w.poly.map(q=>q[1]))+0.1),Math.max(...w.poly.map(q=>q[1]))-0.1);
      const llP=invProj([(px/S)*(maxX-minX)+minX,(py/(S*sy))*(maxY-minY)+minY]);
      pus.push({code:`PU-${String(li+1).padStart(3,'0')}-${String(wi+1).padStart(3,'0')}-${String(p+1).padStart(2,'0')}`,name:t.name+(n>1?['',' II'][p]:''),lat:+llP[1].toFixed(5),lon:+llP[0].toFixed(5),x:+px.toFixed(2),y:+py.toFixed(2)});
    }
  }
  lgas.push({name:l.name,senatorial:l.senatorial,centroid:[+cen[0].toFixed(2),+cen[1].toFixed(2)],lat:+ll[1].toFixed(4),lon:+ll[0].toFixed(4),poly:polyN,wards:wards.map(w=>({...w,pus:w.pus||[]}))});
  // attach PUs to nearest ward centroid (guarantees full coverage)
  for(const p of pus){
    let bw=null,bd=Infinity;
    for(const w of lgas[lgas.length-1].wards){const d=(p.x-w.centroid[0])**2+(p.y-w.centroid[1])**2;if(d<bd){bd=d;bw=w;}}
    if(bw)bw.pus.push(p);
  }
}
console.log('LGAs:',lgas.length,'Wards:',lgas.reduce((a,l)=>a+l.wards.length,0),'PUs:',puCounter);
const out={bounds:[0,0,S,+(S*sy).toFixed(2)],senatorial:Object.keys(SENATORIAL),lgas};
fs.writeFileSync('data/geo.json',JSON.stringify(out));
console.log('geo.json written:',(fs.statSync('data/geo.json').size/1024).toFixed(0),'KB');
