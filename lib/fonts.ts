import { Bricolage_Grotesque, Geist } from "next/font/google";

// Self-hosted by next/font at build time, so the running app makes no font
// requests. Shared by the app's layout and the static demo's.
export const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: "800",
  variable: "--font-bricolage",
});
