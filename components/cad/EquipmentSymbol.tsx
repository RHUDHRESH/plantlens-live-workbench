import type { AssetKind } from "@/lib/cad";

/** Illustrative equipment symbols, never manufacturer terminal diagrams. */
export function EquipmentSymbol({ kind }: { kind: AssetKind }) {
  return <svg viewBox="0 0 160 76" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {kind === "motor" ? <>
      <path d="M35 22h67v35H35zM102 33h26v12h-26M43 57v7h17v-7M80 57v7h16v-7M48 22v-8h32v8"/>
      <path d="M43 27v25m8-25v25m8-25v25m8-25v25m8-25v25m8-25v25m8-25v25" opacity=".45"/>
      <ellipse cx="35" cy="39.5" rx="10" ry="17.5"/><path d="M24 39h-9m113 0h17"/>
    </> : kind === "drive" ? <>
      <rect x="48" y="8" width="62" height="60" rx="3"/><path d="M54 40h50M57 52h42m-42 5h42m-42 5h42" opacity=".4"/>
      <rect x="58" y="16" width="42" height="15" rx="2"/><path d="M65 24c4-10 7 10 11 0s7 10 11 0M65 8V2m14 6V2m14 6V2M65 68v6m14-6v6m14-6v6"/>
    </> : kind === "controller" ? <>
      <rect x="31" y="10" width="98" height="56" rx="6"/><rect x="66" y="24" width="27" height="27" rx="2"/>
      <path d="M71 20v-5m8 5v-5m8 5v-5M71 55v6m8-6v6m8-6v6M62 29h-5m5 8h-5m5 8h-5M97 29h7m-7 8h7m-7 8h7"/>
      <rect x="25" y="26" width="13" height="21" rx="2"/><path d="M43 17h12m52 0h12M43 58h12m52 0h12" strokeWidth="3"/>
    </> : kind === "sensor" ? <>
      <circle cx="80" cy="29" r="21"/><path d="M64 29a16 16 0 0 1 32 0M80 29l10-11M73 50v9h14v-9m-11 9v11m8-11v11M59 29H39m62 0h20"/>
      <circle cx="80" cy="29" r="2" fill="currentColor"/>
    </> : kind === "ground" ? <path d="M80 8v31M54 39h52M61 47h38M69 55h22M76 63h8"/> : kind === "protection" ? <>
      <rect x="54" y="12" width="52" height="51" rx="2"/><path d="M80 2v20m0 31v21M80 48l13-21M73 25h14M69 54h22"/>
    </> : <>
      <rect x="46" y="11" width="68" height="54" rx="3"/><path d="M79 17v42m5-42v42" strokeDasharray="3 3"/>
      <path d="M20 29h41l10 9-10 9H20m120-18h-36l-10 9 10 9h36"/><path d="M53 17h14m26 42h14" opacity=".5"/>
    </>}
  </svg>;
}
