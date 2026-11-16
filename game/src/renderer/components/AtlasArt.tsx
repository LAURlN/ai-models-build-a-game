import type { UnitState } from '../../shared/contracts';
import { artSeed, unitRecipe } from '../presentation';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export function Portrait({ unit }: { unit: UnitState }) {
  const r = unitRecipe(unit);
  return <svg className="portrait" viewBox="-32 -32 64 64" role="img" aria-label={`${unit.title}, ${unit.weapon.tag}, ${unit.faction}`}>
    <circle r="30" fill="#243c3b" stroke="#c4a15d" strokeWidth="2" />
    <circle r="25" fill="#c3c5a4" />
    <path d={`M-24 22 L${-17-r.mantle*2} 4 L12 4 L24 22 Q0 36 -24 22`} fill={hex(r.factionColor)} stroke={hex(r.trim)} />
    <rect x="-10" y="-15" width="20" height="30" rx="9" fill={hex(r.skin)} />
    <path d="M-14 -9L-11 -24L6 -25L14 -10L4 -16L-8 -13Z" fill={hex(r.hair)} />
    {r.helm===0 && <path d="M-17 -12L-12 -26H11L17 -12L0 -17Z" fill="#597879" stroke={hex(r.trim)}/>}
    {r.helm===1 && <path d="M-18 -13L-6 -32L12 -13L20 -10Z" fill={hex(r.factionColor)} stroke={hex(r.trim)}/>}
    {r.helm===2 && <path d="M-14 -16L-9 -26L0 -20L10 -26L14 -14" fill="none" stroke={hex(r.trim)} strokeWidth="4"/>}
    {r.helm===3 && <path d="M-17 -8L-16 -24L3 -30L17 -17L12 -4L10 -19L-9 -17L-11 -4Z" fill={hex(r.factionColor)} stroke={hex(r.trim)}/>}
    <path d="M-7 -3H-3M3 -3H7" stroke="#243c3b" strokeWidth="2"/>
    <path d="M-3 7Q0 9 4 7" fill="none" stroke="#68472f"/>
    {Array.from({length:r.crest+1},(_,i)=><circle key={i} cx={-8+i*4} cy="22" r="1.5" fill={hex(r.trim)}/>)}
  </svg>;
}

// A locally composed decorative atlas plate, independent of playable terrain.
export function AtlasArt({ small = false }: { small?: boolean }) {
  return <svg className={`atlas-art ${small?'atlas-small':''}`} viewBox="0 0 600 560" aria-hidden="true">
    <defs>
      <pattern id="atlas-grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#89987f" strokeWidth=".6"/></pattern>
      <linearGradient id="atlas-paper" x2="1" y2="1"><stop stopColor="#eee0b9"/><stop offset="1" stopColor="#a4b191"/></linearGradient>
    </defs>
    <path d="M45 74L510 34L566 455L90 516Z" fill="#071d22" opacity=".3" transform="translate(8 15)"/>
    <path d="M45 74L510 34L566 455L90 516Z" fill="url(#atlas-paper)" stroke="#c4a15d" strokeWidth="3"/>
    <path d="M64 89L495 53L545 438L107 495Z" fill="url(#atlas-grid)" stroke="#677d6b"/>
    {[0,1,2,3,4].map(i=><path key={i} d={`M${82+i*10} ${170+i*18} Q${220+i*6} ${80+i*20} 310 ${165+i*17} T${519+i*3} ${210+i*26}`} fill="none" stroke="#7c9474" strokeWidth="1" opacity=".65"/>)}
    <path d="M362 55C340 144 248 152 280 239S406 337 352 466" fill="none" stroke="#789d9b" strokeWidth="49"/>
    <path d="M362 55C340 144 248 152 280 239S406 337 352 466" fill="none" stroke="#c2d3bd" strokeWidth="31"/>
    <path d="M362 55C340 144 248 152 280 239S406 337 352 466" fill="none" stroke="#8caeaa" strokeWidth="1.5" strokeDasharray="8 7"/>
    {Array.from({length:28},(_,i)=> {const h=artSeed(`tree/${i}`),x=112+h%360,y=120+(h>>>10)%300;return <g key={i} transform={`translate(${x} ${y})`}><ellipse cy="14" rx="11" ry="4" fill="#304f43" opacity=".18"/><path d="M0 -16L12 11H-12Z" fill={i%2?'#537862':'#426b59'} stroke="#2b5249"/><path d="M0 -12L-7 7" stroke="#a8bc90"/></g>;})}
    <path d="M233 229L326 208L334 234L241 255Z" fill="#d4bd8b" stroke="#52675c" strokeWidth="3"/>
    <path d="M237 234L329 214M239 247L332 227" stroke="#79684c" strokeDasharray="3 4" strokeWidth="3"/>
    <g transform="translate(410 325)"><path d="M-39 18V-23H-29V-34H-15V-23H16V-34H30V-23H40V18Z" fill="#6c7f74" stroke="#354f49" strokeWidth="2"/><path d="M-10 18V-5Q0 -21 10 -5V18" fill="#2b4843"/><path d="M-38 20H42" stroke="#c0c7a7" strokeWidth="3"/></g>
    <path d="M153 354L204 329L259 279L293 233L371 221" fill="none" stroke="#8c573b" strokeWidth="2" strokeDasharray="5 6"/>
    {[{x:165,y:353,enemy:false},{x:227,y:296,enemy:false},{x:377,y:218,enemy:true}].map((p,i)=><g key={i} transform={`translate(${p.x} ${p.y})`}><ellipse cy="21" rx="25" ry="8" fill="#233e39" opacity=".3"/><path d={p.enemy?'M0 -31L29 0L0 31L-29 0Z':'M-25 -27H25V7L0 29L-25 7Z'} fill={p.enemy?'#9e4536':'#23657a'} stroke="#fff2d4" strokeWidth="3"/><circle cy="-3" r="16" fill="#c5b78f" stroke="#c4a15d" strokeWidth="2"/><path d="M-10 10L0 -13L10 10M-7 4H7" fill="none" stroke="#26464a" strokeWidth="3"/></g>)}
    <g transform="translate(474 113)" stroke="#344f46" fill="none"><circle r="27"/><path d="M0 -37V37M-37 0H37M-16 -16L16 16M16 -16L-16 16"/><path d="M0 -25L6 6L0 0L-6 6Z" fill="#344f46"/><text x="0" y="-42" textAnchor="middle" fill="#344f46" stroke="none" fontSize="13" fontFamily="Georgia">N</text></g>
    <text x="124" y="455" fill="#405f51" fontFamily="Georgia" fontSize="19" letterSpacing="4">THE BRASS WARD</text>
  </svg>;
}
