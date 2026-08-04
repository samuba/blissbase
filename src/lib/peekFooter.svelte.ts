/** Shared peek-footer visibility so chrome like the create FAB can move with it. */
class PeekFooterStore {
	/** Effective mobile visibility (scroll + keyboard). Desktop footer stays shown via CSS. */
	shown = $state(true);
}

export const peekFooter = new PeekFooterStore();
