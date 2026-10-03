// A row menu's item. Not in row-menu.tsx: that is a client module, and server files (member-menu.tsx) use these too;
// a value imported from a client module into a server file is a client reference, not the string.
export const menuItem = "flex w-full items-center whitespace-nowrap rounded-md px-3 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const menuItemDanger = `${menuItem} text-danger`;
