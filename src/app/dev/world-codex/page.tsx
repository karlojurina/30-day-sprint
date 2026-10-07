import { notFound } from "next/navigation";
import { Bricolage_Grotesque } from "next/font/google";
import { MapExperience } from "@/components/world-codex/MapExperience";

const display = Bricolage_Grotesque({ subsets: ["latin"], display: "swap", variable: "--font-codex-map" });

export const metadata = { title: "EcomTalent — Codex map study", robots: { index: false, follow: false } };

export default function CodexMapPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <div className={display.variable}><MapExperience /></div>;
}
