"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, Cpu, Radio, Fingerprint, SlidersHorizontal, Workflow, Check, Copy, FileCode2, Activity } from "lucide-react";
import { useLiveWorkspace } from "./LiveWorkspace";
import styles from "./live-experience.module.css";

export function MotorStage() {
  const [selected, setSelected] = useState(0);
  const parts = [
    ["01", "Acquisition", "Three raw sensor inputs", "The MCU acquires raw counts. Sensor meaning and calibration are assigned through a reviewed mapping."],
    ["02", "Drive telemetry", "VFD model required", "Current, frequency, and status require the exact drive manual before physical register mapping."],
    ["03", "Digital twin", "Configuration + observations", "The twin combines approved asset definitions with channel values and their source quality."],
  ];
  return <div className={styles.stage}>
    <div className={styles.stageHeading}><span>INDUCTION MOTOR / REFERENCE ASSEMBLY</span><span>ILLUSTRATION</span></div>
    <svg className={styles.motor} viewBox="0 0 600 330" role="img" aria-label="Illustrated induction motor with cooling fins, shaft, and three sensor attachment points">
      <defs><linearGradient id="motor-body" x2="0" y2="1"><stop stopColor="#a2b6b4"/><stop offset=".45" stopColor="#536e6b"/><stop offset="1" stopColor="#273f3e"/></linearGradient><linearGradient id="motor-cap"><stop stopColor="#3b5452"/><stop offset="1" stopColor="#172e2d"/></linearGradient></defs>
      <g stroke="#9fbab4" strokeOpacity=".16"><path d="M30 280H570M60 250H540M90 220H510M120 190H480"/><path d="M90 300L230 180M210 310L280 180M330 310L330 180M450 310L380 180M570 300L430 180"/></g>
      <ellipse cx="312" cy="271" rx="192" ry="22" fill="#001b19" opacity=".4"/>
      <path d="M211 239L190 275H250L272 242M356 238L342 275H406L419 236" fill="#405d59" stroke="#79948a"/>
      <path d="M183 122L385 94Q444 95 460 163V203Q447 246 386 254L181 222Z" fill="url(#motor-body)" stroke="#a0b6aa"/>
      {Array.from({length:12},(_,i)=><path key={i} d={`M${207+i*16} ${119-i*2}v116`} stroke="#203c38" strokeWidth="8"/>)}
      <ellipse cx="187" cy="175" rx="53" ry="61" fill="url(#motor-cap)" stroke="#94aaa2" strokeWidth="3"/>
      <ellipse cx="187" cy="175" rx="39" ry="46" fill="none" stroke="#78968e" strokeWidth="2"/>
      <ellipse cx="187" cy="175" rx="22" ry="26" fill="#12312c" stroke="#58786c"/>
      <path d="M184 161L97 171V192L184 190Q203 177 184 161Z" fill="#a1b4ac"/><ellipse cx="97" cy="181" rx="7" ry="11" fill="#c9d4cb"/>
      <path d="M274 103V70L343 58L371 75V104L304 116Z" fill="#48665e" stroke="#a8b9ad"/><path d="M274 70L303 85L371 75M303 85V116" fill="none" stroke="#8baba0"/>
      <g fill="#d5eea1" stroke="#d5eea1"><circle cx="220" cy="135" r="5"/><path d="M220 135L195 72H97" fill="none"/><circle cx="386" cy="211" r="5"/><path d="M386 211L464 252H519" fill="none"/><circle cx="343" cy="75" r="5"/><path d="M343 75L415 42H520" fill="none"/></g>
      <g fill="#c5d6cd" fontSize="11" fontFamily="monospace"><text x="72" y="64">SENSOR INPUTS</text><text x="443" y="33">TERMINAL BOX</text><text x="465" y="270">MTR-01</text></g>
    </svg>
    <div className={styles.partTabs}>{parts.map(([number,label],i)=><button key={label} aria-pressed={selected===i} onClick={()=>setSelected(i)}><span>{number}</span>{label}</button>)}</div>
    <div className={styles.partDetail}><strong>{parts[selected][2]}</strong><p>{parts[selected][3]}</p></div>
  </div>;
}

export function LiveOverview() {
  const live=useLiveWorkspace();
  const steps=[
    {title:"Connect your device", detail:"Select the source. Inspect its identity.", href:"/live/devices", icon:Radio, done:!!live.profile},
    {title:"Describe your plant", detail:"Turn your equipment description into a draft.", href:"/live/agents", icon:Workflow, done:!!live.proposal},
    {title:"Review the mappings", detail:"Check units, scaling, and the evidence.", href:"/live/mappings", icon:SlidersHorizontal, done:live.mappings.some(m=>m.state==="APPROVED")},
    {title:"Explore the twin", detail:"See the approved configuration in context.", href:"/live/twin", icon:Activity, done:live.assets.length>0},
  ];
  return <div className={styles.experience}>
    <div className={styles.eyebrow}><span className={styles.dot}/> PLANTLENS WORKSPACE <span>01 / MOTOR MONITORING</span></div>
    <div className={styles.hero}><div className={styles.heroCopy}><span className={styles.kicker}>FROM SIGNAL TO UNDERSTANDING</span><h1>Your plant.<br/>In full view.</h1><p>Connect the hardware. Give every signal a meaning. Build a digital twin you can inspect, explain, and refine.</p><div className={styles.actions}><Link href={live.profile?"/live/agents":"/live/devices"} className={styles.primary}>{live.profile?"Configure your plant":"Connect a device"}<ArrowRight size={17}/></Link><Link href="/live/firmware" className={styles.secondary}>Prepare UNO Q<ArrowUpRight size={16}/></Link></div><div className={styles.heroNote}><Fingerprint size={17}/><span>{live.profile?live.profile.boardModel:"Your workspace starts with a verified source."}</span></div></div><MotorStage/></div>
    <div className={styles.metrics}>{[["SOURCE",live.profile?live.connection:"Not connected",live.profile?.boardModel??"Select hardware or demonstration"],["RAW CHANNELS",String(live.profile?.channelCount??0),"Discovered from device descriptor"],["CONFIGURATION",`r${live.revision}`,`${live.assets.length} assets · ${live.mappings.filter(m=>m.state==="APPROVED").length} approved bindings`],["REVIEW",live.proposal?.status??"No pending draft","Human approval before publication"]].map(([label,value,note])=><div key={label}><span>{label}</span><strong>{value}</strong><p>{note}</p></div>)}</div>
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>YOUR NEXT STEPS</span><h2>Make the connection.</h2></div><span>{steps.filter(s=>s.done).length} / 4 ready</span></div>
    <div className={styles.steps}>{steps.map((step,i)=><Link key={step.href} href={step.href}><div className={styles.stepTop}><step.icon size={22}/><span>{step.done?<Check size={18}/>:String(i+1).padStart(2,"0")}</span></div><h3>{step.title}</h3><p>{step.detail}</p><ArrowUpRight size={18}/></Link>)}</div>
    <div className={styles.bottomNote}><Cpu size={21}/><div><strong>One workspace. Two ways to explore.</strong><p>The public demo uses generated signals. Physical acquisition runs through the companion on your PC.</p></div><Link href="/live/firmware">Firmware & setup<ArrowRight size={16}/></Link></div>
  </div>;
}

export function FirmwareStudio(){
  const [copied,setCopied]=useState(false);
  const command="cd companion\nnpm ci\nnpm start";
  const copy=async()=>{try{await navigator.clipboard.writeText(command);setCopied(true);}catch{setCopied(false);}};
  return <div className={styles.experience}><div className={styles.eyebrow}><span className={styles.dot}/> DEVICE WORKBENCH <span>ARDUINO UNO Q</span></div><div className={styles.firmwareTitle}><div><span className={styles.kicker}>FIRMWARE & ACQUISITION</span><h1>Two processors.<br/>One clear signal.</h1><p>Prepare the board, inspect the acquisition contract, and connect your local workspace.</p></div><span className={styles.release}>SOURCE PACKAGE<br/><strong>0.1.0</strong><span>Hardware verification pending</span></span></div>
    <div className={styles.firmwareGrid}><section className={styles.processor}><Cpu size={28}/><span className={styles.kicker}>ACQUISITION CORE</span><h2>STM32 MCU</h2><p>Three analog inputs, sampled every 50 milliseconds and published through Arduino Bridge.</p><div className={styles.pinGrid}>{["A0","A1","A2"].map((pin,i)=><div key={pin}><strong>{pin}</strong><span>Sensor {i+1}</span><small>RAW ADC</small></div>)}</div><footer>20 Hz target · no calibration assumed</footer></section><section className={styles.processor}><Workflow size={28}/><span className={styles.kicker}>DEVICE GATEWAY</span><h2>Debian Linux</h2><p>Receives the MCU samples and exposes device descriptors, health, and a bounded telemetry snapshot.</p><dl><div><dt>Identity</dt><dd>Provisioned UUID</dd></div><div><dt>Schema</dt><dd>SHA-256 digest</dd></div><div><dt>Buffer</dt><dd>512 batches</dd></div></dl><footer>Bridge / RPC → WebUI service</footer></section></div>
    <div className={styles.sectionHeading}><div><span className={styles.kicker}>BRING YOUR BOARD ONLINE</span><h2>From source to session.</h2></div><Link href="/live/devices" className={styles.secondary}>Open Devices<ArrowRight size={16}/></Link></div>
    <div className={styles.setupGrid}><div className={styles.setupSteps}>{[["01","Open the App Lab source","Use firmware/uno-q from the repository. The Python gateway and MCU sketch are packaged together."],["02","Provision the device","Set PLANTLENS_DEVICE_UUID to a persistent UUID and PLANTLENS_FIRMWARE_HASH to your build artifact’s SHA-256."],["03","Check acquisition","Inspect descriptor, health, and snapshot endpoints. Confirm the three inputs remain raw and unmapped."],["04","Start the PC companion","Copy its pairing token into Devices on localhost. COM requires firmware that implements the companion’s serial protocol; App Lab currently exposes HTTP."]].map(([number,title,detail])=><div key={number}><span>{number}</span><div><h3>{title}</h3><p>{detail}</p></div></div>)}</div><div className={styles.codeCard}><header><FileCode2 size={17}/> WINDOWS / POWERSHELL<button onClick={copy} aria-label="Copy companion startup commands">{copied?<Check size={16}/>:<Copy size={16}/>}</button></header><pre>{command}</pre><p>Requires Node.js 22.13 or later.<br/>The pairing token is shown at startup.</p><a href="https://github.com/RHUDHRESH/plantlens-live-workbench/tree/main/firmware/uno-q" target="_blank" rel="noreferrer">View firmware source<ArrowUpRight size={16}/></a></div></div>
    <div className={styles.bottomNote}><Fingerprint size={22}/><div><strong>Hardware status: awaiting bench verification</strong><p>The source is available. Board compilation, electrical isolation, and physical readings still need validation against your exact hardware.</p></div></div>
  </div>;
}
