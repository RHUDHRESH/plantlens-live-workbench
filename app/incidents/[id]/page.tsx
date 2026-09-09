"use client";
import { useParams } from "next/navigation";
import { IncidentView } from "@/components/workbench/Views";
export default function Page(){const p=useParams<{id:string}>();return <IncidentView id={p.id}/>}
