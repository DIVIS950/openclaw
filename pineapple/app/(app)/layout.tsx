import { TabBar } from "@/components/TabBar";

// Every page in this group checks the session itself (requireSession); proxy.ts is only a fast path.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main className="page">{children}</main>
      <TabBar />
    </>
  );
}
