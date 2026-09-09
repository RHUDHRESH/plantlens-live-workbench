"use client";
import { useParams } from "next/navigation";
import { AssetView } from "@/components/workbench/Views";
export default function Page(){const p=useParams<{id:string}>();return <AssetView id={p.id}/>}
