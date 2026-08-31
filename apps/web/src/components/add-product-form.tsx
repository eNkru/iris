"use client";

import { useState, type FormEvent } from "react";
import { useCreateProduct } from "../hooks/use-products";
import { useI18n } from "../lib/i18n";
import { hasValidationIssue } from "../lib/orpc-validation";
import { Button, ErrorBox, Input, Label, Spinner, formatPrice } from "./ui";

/**
 * Add-a-product form (R4): submits a URL, runs the synchronous first check on
 * the server, and reports the resulting price (AC2).
 */
export function AddProductForm() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createProduct = useCreateProduct();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    // Clear the previous success banner before the new attempt so a stale
    // "added" result doesn't linger while the new add is pending.
    createProduct.reset();

    if (!url.trim()) {
      setError(t("addProduct.empty"));
      return;
    }

    try {
      const result = await createProduct.mutateAsync({ url: url.trim() });

      if (result.check.status === "changed" || result.check.status === "unchanged") {
        setUrl("");
      } else if (result.check.status === "unavailable") {
        setError(t("addProduct.unavailable"));
      } else if (result.check.status === "failed") {
        setError(result.check.reason || t("addProduct.failed"));
      } else if (result.check.status === "not_found") {
        setError(t("addProduct.notFound"));
      }
    } catch (err) {
      // Point at the offending field when the server rejected the input.
      setError(
        hasValidationIssue(err, "url")
          ? t("validation.url")
          : t("addProduct.error"),
      );
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="product-url">{t("addProduct.label")}</Label>
        <Input
          id="product-url"
          type="url"
          required
          placeholder={t("addProduct.placeholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={createProduct.isPending}
        />
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {createProduct.data?.check.status === "changed" ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {t("addProduct.addedChanged", {
            price: formatPrice(
              createProduct.data.check.newPrice,
              createProduct.data.check.currency,
            ),
          })}
        </p>
      ) : null}
      {createProduct.data?.check.status === "unchanged" ? (
        <p className="text-sm text-stone-600 dark:text-stone-300">
          {t("addProduct.addedUnchanged", {
            price: formatPrice(
              createProduct.data.check.price,
              createProduct.data.product.currency,
            ),
          })}
        </p>
      ) : null}

      <Button type="submit" disabled={createProduct.isPending}>
        {createProduct.isPending ? (
          <Spinner label={t("addProduct.checking")} />
        ) : (
          t("addProduct.submit")
        )}
      </Button>
    </form>
  );
}