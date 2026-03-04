import {
  FolderIcon,
  PlayIcon,
  SquaresPlusIcon,
} from "@heroicons/react/24/solid";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type * as PageTree from "fumadocs-core/page-tree";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactElement, ReactNode } from "react";
import { LogoLockup } from "@/components/icons/logo";
import { source } from "@/lib/source";

const categoryIcons = {
  "get started": <PlayIcon className="docs-category-icon size-3! shrink-0" />,
  integrations: (
    <SquaresPlusIcon className="docs-category-icon size-3! shrink-0" />
  ),
  project: <FolderIcon className="docs-category-icon size-3! shrink-0" />,
} as const;

function getCategoryIcon(name: string): ReactElement | undefined {
  return categoryIcons[name.toLowerCase() as keyof typeof categoryIcons];
}

function CategoryFolderIcon({ icon }: { icon?: ReactElement }) {
  return (
    <>
      {icon}
      <HugeiconsIcon
        icon={ArrowDown01Icon}
        strokeWidth={2}
        className="docs-category-chevron pointer-events-none absolute right-5 top-1/2 size-4 -translate-y-1/2 transition-transform duration-150"
      />
    </>
  );
}

function groupCategories(nodes: PageTree.Node[]): PageTree.Node[] {
  const grouped: PageTree.Node[] = [];
  let currentCategory: PageTree.Folder | null = null;

  for (const node of nodes) {
    if (node.type === "separator" && node.name) {
      currentCategory = {
        type: "folder",
        name: node.name,
        collapsible: true,
        defaultOpen: false,
        children: [],
      } as PageTree.Folder;

      const icon =
        typeof node.name === "string" ? getCategoryIcon(node.name) : undefined;
      (
        currentCategory as PageTree.Folder & {
          icon?: ReactElement;
        }
      ).icon = <CategoryFolderIcon icon={icon} />;

      grouped.push(currentCategory);
      continue;
    }

    let mappedNode =
      node.type === "folder"
        ? {
            ...node,
            children: groupCategories(node.children),
          }
        : node;

    if (
      mappedNode.type === "folder" &&
      currentCategory &&
      mappedNode.collapsible === undefined
    ) {
      mappedNode = {
        ...mappedNode,
        collapsible: false,
        defaultOpen: true,
      };
    }

    if (currentCategory) {
      currentCategory.children.push(mappedNode);
      continue;
    }

    grouped.push(mappedNode);
  }

  return grouped;
}

function withCollapsibleCategories(tree: PageTree.Root): PageTree.Root {
  return {
    ...tree,
    children: groupCategories(tree.children),
  };
}

export default function Layout({ children }: { children: ReactNode }) {
  const tree = withCollapsibleCategories(source.pageTree);

  return (
    <DocsLayout
      tree={tree}
      nav={{
        title: (
          <div className="flex flew-row items-center">
            <LogoLockup className="h-4.5" />
            <span className="leading-none ml-2.5 mb-[5px] text-foreground/50 font-normal scale-110">
              docs
            </span>
          </div>
        ),
        url: "/",
      }}
    >
      {children}
    </DocsLayout>
  );
}
