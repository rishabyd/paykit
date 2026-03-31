"use client";

import { Github } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";

import { URLs } from "@/lib/consts";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const ComingSoonContext = createContext<() => void>(() => {});

export function useComingSoon() {
  return useContext(ComingSoonContext);
}

export function ComingSoonProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  const show = useCallback(() => setOpen(true), []);

  return (
    <ComingSoonContext value={show}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Coming Soon</DialogTitle>
            <DialogDescription>
              PayKit is in early development. Documentation and guides are being written. Star us on
              GitHub to follow along.
            </DialogDescription>
          </DialogHeader>
          <Button
            render={<a href={URLs.githubRepo} target="_blank" rel="noopener noreferrer" />}
            nativeButton={false}
            variant="outline"
            className="w-full"
            onClick={() => setOpen(false)}
          >
            <Github className="size-4" />
            Star on GitHub
          </Button>
        </DialogContent>
      </Dialog>
    </ComingSoonContext>
  );
}
