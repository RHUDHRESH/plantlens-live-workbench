"use client";
import { useParams } from "next/navigation";
import { WorkOrderView } from "@/components/workbench/Views";
export default function Page(){const p=useParams<{id:string}>();return <WorkOrderView id={p.id}/>}
