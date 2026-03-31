import { HeroCodeBlock } from "@/components/landing/hero-code-block";
import { HeroTitle } from "@/components/landing/hero-title";
import { Section, SectionContent } from "@/components/layout/section";
import { heroConfigCode, heroPaykitCode } from "@/components/sections/readme-code-content";
import { CodeBlockContent } from "@/components/ui/code-block-content";

const codeBlockOverrides = {
  className:
    "border-0 my-0 shadow-none bg-card! [&_div]:bg-card! max-lg:[&_.line::after]:!hidden max-lg:[&_.line]:!pl-3 lg:[&_.line::after]:w-4 lg:[&_.line::after]:text-right lg:[&_.line::after]:left-2",
  keepBackground: false,
  viewportProps: {
    className: "overflow-x-auto overflow-y-visible max-h-none",
  },
} as const;

export function HeroSection() {
  return (
    <Section>
      <SectionContent className="pt-14 sm:pt-16 lg:pt-36 pb-16 lg:pb-24">
        <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="lg:max-w-lg">
            <HeroTitle />
          </div>

          <HeroCodeBlock
            plansCodeBlock={
              <CodeBlockContent
                lang="ts"
                code={heroPaykitCode}
                codeblock={codeBlockOverrides}
                allowCopy={false}
              />
            }
            configCodeBlock={
              <CodeBlockContent
                lang="ts"
                code={heroConfigCode}
                codeblock={codeBlockOverrides}
                allowCopy={false}
              />
            }
          />
        </div>
      </SectionContent>
    </Section>
  );
}
