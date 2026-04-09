import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

import { shikiThemes } from "@/lib/shiki-themes";

const managers = ["pnpm", "bun", "npm"] as const;

function installCommand(pkg: string, manager: string) {
  if (manager === "npm") return `npm install ${pkg}`;
  return `${manager} add ${pkg}`;
}

function runCommand(command: string, manager: string) {
  if (manager === "pnpm") return `pnpm dlx ${command}`;
  if (manager === "bun") return `bunx ${command}`;
  return `npx ${command}`;
}

export function PackageInstall({ package: pkg }: { package: string }) {
  return (
    <Tabs items={[...managers]}>
      {managers.map((m) => (
        <Tab key={m} value={m}>
          <DynamicCodeBlock
            lang="bash"
            code={installCommand(pkg, m)}
            options={{ themes: shikiThemes }}
          />
        </Tab>
      ))}
    </Tabs>
  );
}

export function PackageRun({ command }: { command: string }) {
  return (
    <Tabs items={[...managers]}>
      {managers.map((m) => (
        <Tab key={m} value={m}>
          <DynamicCodeBlock
            lang="bash"
            code={runCommand(command, m)}
            options={{ themes: shikiThemes }}
          />
        </Tab>
      ))}
    </Tabs>
  );
}
