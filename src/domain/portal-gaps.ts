/**
 * Trade-portal items that stay out of navigation.
 * Do not render placeholder balances, saved lists, or user-admin screens for these.
 */
export const HIDDEN_PORTAL_CAPABILITIES = [
  {
    id: "portal-invoices",
    route: "src/routes/portal.invoices.tsx",
    dependency:
      "Invoices and statements stay hidden until a customer account-ledger feed exists. Despatch documents are not a statement or a balance.",
  },
  {
    id: "portal-favourites",
    route: "src/routes/portal.favourites.tsx",
    dependency: "Saved favourites and order lists are not stored for trade accounts.",
  },
  {
    id: "portal-users",
    route: "src/routes/portal.users.tsx",
    dependency: "Trade users cannot manage company users. Invitations stay with Automotive Brands staff.",
  },
  {
    id: "portal-downloads",
    route: null,
    dependency:
      "There is no trade document library. Product documents stay on the product page, and the public resources page is not a customer download area.",
  },
] as const;
