import type { Metadata } from "next";
import { Dashboard } from "./Dashboard";

export const metadata: Metadata = {
  title: "Atlas Markets · 科技投资晨报",
  description: "面向美股科技投资者的市场、自选股、宏观与加密资产晨间看板。",
};

export default function Home() {
  return <Dashboard />;
}
