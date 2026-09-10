import { CadWorkbench } from "@/components/cad/CadWorkbench";
import { LocalModelSetup } from "@/components/desktop/LocalModelSetup";
import { ContextDock } from "@/components/engineering/ContextDock";
export default function WorkbenchPage() { return <><LocalModelSetup/><CadWorkbench/><ContextDock/></>; }
