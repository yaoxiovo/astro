import SiteCard from "@/components/SiteCard.astro";

export function siteDirective() {
  return (tree: any) => {
    visit(tree, (node: any) => {
      if (node.type === "containerDirective" && node.name === "site") {
        node.data ||= {};
        node.data.hName = "SiteCard";
        node.data.hProperties = node.attributes;
      }
    });
  };
}