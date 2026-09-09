"use client";
import { useParams } from "next/navigation";
import { RecoveryView } from "@/components/workbench/Views";
export default function Page(){const p=useParams<{id:string}>();return <RecoveryView id={p.id}/>}
