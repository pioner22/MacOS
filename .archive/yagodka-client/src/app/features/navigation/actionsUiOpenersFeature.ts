import type { PageKind } from "../../../stores/types";

export interface ActionsUiOpenersFeatureDeps {
  setPage: (page: PageKind) => void;
  openSidebarToolsContextMenu: (x: number, y: number) => void;
}

export interface ActionsUiOpenersFeature {
  onOpenHelp: () => void;
  onOpenSidebarToolsMenu: (x: number, y: number) => void;
}

export function createActionsUiOpenersFeature(deps: ActionsUiOpenersFeatureDeps): ActionsUiOpenersFeature {
  const { setPage, openSidebarToolsContextMenu } = deps;

  const onOpenHelp = () => {
    setPage("help");
  };

  const onOpenSidebarToolsMenu = (x: number, y: number) => {
    openSidebarToolsContextMenu(x, y);
  };

  return {
    onOpenHelp,
    onOpenSidebarToolsMenu,
  };
}
