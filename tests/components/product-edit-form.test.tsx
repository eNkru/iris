import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const { mockUseUpdateProduct } = vi.hoisted(() => ({
  mockUseUpdateProduct: vi.fn(),
}));

vi.mock("../../apps/web/src/hooks/use-products", () => ({
  useUpdateProduct: mockUseUpdateProduct,
}));

vi.mock("../../apps/web/src/lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "editForm.intervalLabel": "Poll interval (minutes)",
        "editForm.intervalPlaceholder": "Empty = use default",
        "editForm.intervalHint": "How often.",
        "editForm.intervalInvalid":
          "Poll interval must be a whole number of minutes (or empty).",
        "editForm.anyChange": "Alert on any price change",
        "editForm.risePct": "Rise threshold (%)",
        "editForm.fallPct": "Fall threshold (%)",
        "editForm.riseAbs": "Rise threshold (abs)",
        "editForm.fallAbs": "Fall threshold (abs)",
        "editForm.thresholdsHint": "Thresholds are direction-specific.",
        "editForm.thresholdInvalid": "Threshold must be a positive number (or blank).",
        "editForm.silent": "No alert rules are active.",
        "editForm.saveError": "Failed to save.",
        "editForm.saved": "Saved.",
        "editForm.saving": "Saving…",
        "editForm.saveChanges": "Save changes",
        "editForm.pause": "Pause tracking",
        "editForm.resume": "Resume tracking",
      };
      return translations[key] ?? key;
    },
  }),
}));

import { ProductEditForm } from "../../apps/web/src/components/product-edit-form";
import type { ProductOutput } from "../../apps/web/src/hooks/use-products";

function makeProduct(overrides: Partial<ProductOutput> = {}): ProductOutput {
  return {
    id: "prod-1",
    userId: "user-1",
    url: "https://shop.test/widget",
    name: "Widget",
    currency: "USD",
    currentPrice: 100,
    imagePath: null,
    lastCheckedAt: null,
    pollIntervalMinutes: null,
    alertRules: {
      anyChange: true,
      risePct: null,
      fallPct: null,
      riseAbs: null,
      fallAbs: null,
    },
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function renderForm(product: ProductOutput = makeProduct()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProductEditForm product={product} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProductEditForm labels and threshold validation", () => {
  beforeEach(() => {
    mockUseUpdateProduct.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
      isPending: false,
    });
  });

  it("associates the interval label with its input (htmlFor/id) (AC1)", () => {
    renderForm();
    const intervalInput = screen.getByPlaceholderText("Empty = use default");
    const intervalLabel = screen.getByText("Poll interval (minutes)");
    expect(intervalInput.id).toBeTruthy();
    expect(intervalLabel.getAttribute("for")).toBe(intervalInput.id);
  });

  it("associates each threshold label with its input (AC1)", () => {
    renderForm();
    const risePctInput = screen.getByLabelText("Rise threshold (%)");
    const fallPctInput = screen.getByLabelText("Fall threshold (%)");
    const riseAbsInput = screen.getByLabelText("Rise threshold (abs)");
    const fallAbsInput = screen.getByLabelText("Fall threshold (abs)");
    // Each label resolves to its input via htmlFor/id.
    expect(risePctInput).toBeInTheDocument();
    expect(fallPctInput).toBeInTheDocument();
    expect(riseAbsInput).toBeInTheDocument();
    expect(fallAbsInput).toBeInTheDocument();
  });

  it("blocks submit and shows an error when a threshold is 0 (AC2)", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    mockUseUpdateProduct.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    });
    renderForm();

    const risePctInput = screen.getByLabelText("Rise threshold (%)");
    await user.type(risePctInput, "0");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      screen.getByText("Threshold must be a positive number (or blank)."),
    ).toBeInTheDocument();
    // Save is disabled while a threshold is invalid.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("blocks submit when a threshold is negative (AC2)", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    mockUseUpdateProduct.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    });
    renderForm();

    await user.type(screen.getByLabelText("Fall threshold (%)"), "-5");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("allows submit when all thresholds are blank (AC3)", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("allows submit when thresholds are positive (AC4)", async () => {
    const user = userEvent.setup();
    const mutateAsync = vi.fn().mockResolvedValue({ success: true });
    mockUseUpdateProduct.mockReturnValue({
      mutate: vi.fn(),
      mutateAsync,
      isPending: false,
    });
    renderForm();

    await user.type(screen.getByLabelText("Rise threshold (%)"), "5");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe("ProductEditForm pause/resume pending split", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Save and pause have independent pending state (AC1/AC2)", () => {
    // The component calls useUpdateProduct() twice: first for Save, then for
    // pause/resume. Return two distinct instances with independent isPending.
    const saveInstance = {
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
      isPending: true, // Save in flight
    };
    const pauseInstance = {
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
      isPending: false,
    };
    mockUseUpdateProduct
      .mockReturnValueOnce(saveInstance)
      .mockReturnValueOnce(pauseInstance);

    renderForm(makeProduct({ active: true }));

    // Save is the form's submit button; while its action is pending it renders
    // the "Saving…" spinner label and is disabled.
    const saveButton = screen.getByRole("button", { name: "Saving…" });
    expect(saveButton).toBeDisabled();
    // The pause button stays enabled (independent pending).
    expect(screen.getByRole("button", { name: "Pause tracking" })).toBeEnabled();
  });

  it("pause pending does not disable Save (AC1)", () => {
    const saveInstance = {
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
      isPending: false,
    };
    const pauseInstance = {
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
      isPending: true, // pause in flight
    };
    mockUseUpdateProduct
      .mockReturnValueOnce(saveInstance)
      .mockReturnValueOnce(pauseInstance);

    renderForm(makeProduct({ active: true }));

    // Save is enabled (its own action not pending)…
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
    // …while the pause button renders the spinner label and is disabled.
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });
});
