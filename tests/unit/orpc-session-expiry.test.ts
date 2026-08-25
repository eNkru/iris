// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetSessionExpiredGuard,
  _setSignOutImpl,
  handleSessionExpired,
  isSessionExpired,
  makeSessionExpiryInterceptor,
} from "../../apps/web/src/lib/orpc-session-expiry";

function setLocation(pathname: string): { assign: ReturnType<typeof vi.fn> } {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    value: { pathname, assign },
    writable: true,
    configurable: true,
  });
  return { assign };
}

describe("isSessionExpired", () => {
  it("returns true only for HTTP 401", () => {
    expect(isSessionExpired(401)).toBe(true);
    expect(isSessionExpired(403)).toBe(false);
    expect(isSessionExpired(500)).toBe(false);
    expect(isSessionExpired(200)).toBe(false);
  });
});

describe("handleSessionExpired", () => {
  let signOut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signOut = vi.fn().mockResolvedValue(undefined);
    _setSignOutImpl(signOut);
    _resetSessionExpiredGuard();
  });
  afterEach(() => {
    _resetSessionExpiredGuard();
  });

  it("signs out and redirects to /login", async () => {
    const { assign } = setLocation("/products");

    await handleSessionExpired();

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("is idempotent: concurrent calls trigger exactly one sign-out + redirect", async () => {
    const { assign } = setLocation("/products");

    await Promise.all([
      handleSessionExpired(),
      handleSessionExpired(),
      handleSessionExpired(),
      handleSessionExpired(),
      handleSessionExpired(),
    ]);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("does not redirect when already on /login (no loop)", async () => {
    const { assign } = setLocation("/login");

    await handleSessionExpired();

    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("makeSessionExpiryInterceptor", () => {
  let signOut: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signOut = vi.fn().mockResolvedValue(undefined);
    _setSignOutImpl(signOut);
    _resetSessionExpiredGuard();
  });

  it("calls next and returns the response unchanged on a 200", async () => {
    const next = vi.fn().mockResolvedValue({ status: 200 });
    const interceptor = makeSessionExpiryInterceptor<{ status: number }>();
    const res = await interceptor({ next });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ status: 200 });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("triggers recovery on a 401 and still returns the response", async () => {
    setLocation("/products");
    const next = vi.fn().mockResolvedValue({ status: 401 });
    const interceptor = makeSessionExpiryInterceptor<{ status: number }>();
    const res = await interceptor({ next });

    expect(res).toEqual({ status: 401 });
    // Recovery is fire-and-forget (`void handleSessionExpired()`); allow it to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
