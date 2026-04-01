import type { ReactNode } from "react";

import { ComingSoonProvider } from "@/components/coming-soon-dialog";
import { CommandMenuProvider } from "@/components/command-menu";
import { NavigationBar } from "@/components/layout/navigation-bar";
import { PageTransition } from "@/components/layout/page-transition";
import { getGitHubStars } from "@/lib/github";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const stars = await getGitHubStars();

  return (
    <CommandMenuProvider>
      <ComingSoonProvider>
        <div className="dark bg-background text-foreground relative min-h-dvh">
          <NavigationBar stars={stars} />
          <PageTransition>{children}</PageTransition>
        </div>
      </ComingSoonProvider>
    </CommandMenuProvider>
  );
}
