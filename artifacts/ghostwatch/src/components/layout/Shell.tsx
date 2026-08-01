import { Sidebar } from "./Sidebar";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] bg-background text-foreground selection:bg-primary/30">
      <Sidebar />
      <main className="flex-1 flex flex-col h-[100dvh] overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
