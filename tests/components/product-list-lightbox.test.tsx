import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const {
  mockUseProducts,
  mockUseCheckNow,
  mockUseDeleteProduct,
  mockUseUpdateProduct,
  mockUseSendSummary,
} = vi.hoisted(() => ({
  mockUseProducts: vi.fn(),
  mockUseCheckNow: vi.fn(),
  mockUseDeleteProduct: vi.fn(),
  mockUseUpdateProduct: vi.fn(),
  mockUseSendSummary: vi.fn(),
}));

vi.mock("../../apps/web/src/hooks/use-products", () => ({
  useProducts: mockUseProducts,
  useCheckNow: mockUseCheckNow,
  useDeleteProduct: mockUseDeleteProduct,
  useUpdateProduct: mockUseUpdateProduct,
}));

vi.mock("../../apps/web/src/hooks/use-channels", () => ({
  useSendSummary: mockUseSendSummary,
}));

vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        "productList.loading": "Loading products...",
        "productList.loadError": "Failed to load products.",
        "productList.empty": "No products yet",
        "productList.emptyTitle": "Nothing tracked yet",
        "productList.active": "Active",
        "productList.paused": "Paused",
        "productList.noPrice": "No price recorded yet",
        "productList.closeLightbox": "Close",
        "productList.checked": " checked ",
        "productList.checkNow": "Check now",
        "productList.checking": "Checking...",
        "productList.pause": "Pause",
        "productList.resume": "Resume",
        "productList.delete": "Delete",
        "productList.deleting": "Deleting...",
        "productList.confirmDelete": "Confirm delete",
        "productList.cancel": "Cancel",
        "productList.refresh": "Refresh",
        "productList.deleteError": "Failed to delete product.",
        "productList.sendSummary": "Send summary",
        "productList.sending": "Sending...",
        "productList.summarySent": "Summary sent ({n} {items})",
        "productList.summarySent.one": "item",
        "productList.summarySent.other": "items",
        "productList.openImage": "Open image for {name}",
        "productList.imageDialog": "Product image: {name}",
        "tooltip.aria": "Help",
        "tooltip.title": "How to set up Telegram",
        "tooltip.step1": "Step 1",
        "tooltip.step2": "Step 2",
        "tooltip.step3": "Step 3",
        "tooltip.step4": "Step 4",
      };
      const template = translations[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name) => {
        const value = vars[name];
        return value === undefined ? `{${name}}` : String(value);
      });
    },
    lang: "en",
    setLang: () => {},
    mounted: true,
  }),
}));

const { ProductList } = await import(
  "../../apps/web/src/components/product-list"
);

const productWithImage = {
  id: "prod-img",
  userId: "user-1",
  url: "https://shop.test/widget",
  name: "Widget",
  currency: "USD",
  currentPrice: 100,
  imagePath: "prod-img.png",
  lastCheckedAt: null,
  pollIntervalMinutes: null,
  alertRules: { anyChange: true, risePct: null, fallPct: null, riseAbs: null, fallAbs: null },
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  latestReading: null,
};

function renderProductList() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setHookDefaults() {
  mockUseProducts.mockReturnValue({
    data: { products: [productWithImage] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseCheckNow.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseDeleteProduct.mockReturnValue({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  mockUseUpdateProduct.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUseSendSummary.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
}

describe("ProductList lightbox accessibility", () => {
  beforeEach(() => setHookDefaults());

  it("opens a dialog with role=dialog + aria-modal and an accessible name (AC4)", async () => {
    const user = userEvent.setup();
    renderProductList();

    await user.click(screen.getByRole("button", { name: "Open image for Widget" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.getAttribute("aria-label")).toBe("Product image: Widget");
  });

  it("moves focus to the Close button on open (AC1)", async () => {
    const user = userEvent.setup();
    renderProductList();

    await user.click(screen.getByRole("button", { name: "Open image for Widget" }));

    const closeBtn = screen.getByRole("button", { name: "Close" });
    expect(closeBtn).toHaveFocus();
  });

  it("closes on Escape and returns focus to the triggering thumbnail (AC2/AC1)", async () => {
    const user = userEvent.setup();
    renderProductList();

    const trigger = screen.getByRole("button", { name: "Open image for Widget" });
    await user.click(trigger);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on backdrop click (AC6)", async () => {
    const user = userEvent.setup();
    renderProductList();

    await user.click(screen.getByRole("button", { name: "Open image for Widget" }));
    const dialog = screen.getByRole("dialog");
    // Click the backdrop (the dialog element itself, not the image/close button).
    await user.click(dialog);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uses the product name as the image alt (not hardcoded English) (AC5)", async () => {
    const user = userEvent.setup();
    renderProductList();

    await user.click(screen.getByRole("button", { name: "Open image for Widget" }));

    const dialog = screen.getByRole("dialog");
    const img = dialog.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Widget");
  });

  it("locks background scroll while open and restores it on close (AC3)", async () => {
    const user = userEvent.setup();
    const prevOverflow = document.body.style.overflow;
    renderProductList();

    await user.click(screen.getByRole("button", { name: "Open image for Widget" }));
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe(prevOverflow);
  });
});
