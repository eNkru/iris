# Check image size before full base64 decode

## Goal

`extract-image.ts` decodes the full base64 payload (`Buffer.from(data, "base64")`, up to ~13MB base64 → 10MB binary) *before* checking `MAX_IMAGE_BYTES`. A misbehaving or hostile argus can spike process memory. Check the base64 string length first and reject oversized images before decoding.

## Background / Confirmed Facts

Verified against current code (2026-08-25):

- `packages/prices/src/pipeline/extract-image.ts:288-292` — inside `retryWithBackoff` callback: `const buffer = Buffer.from(data, "base64")` runs first, then `if (buffer.byteLength > MAX_IMAGE_BYTES)` checks size. Full decode precedes the size guard.

## Requirements

- **R1.** Before `Buffer.from`, estimate the decoded size from the base64 string length (≈ `data.length * 3 / 4`, minus padding) and reject early if it exceeds `MAX_IMAGE_BYTES`.
- **R2.** The early-reject path returns the same terminal result as today's post-decode reject (same reason/shape) so callers and dispatch behave identically.
- **R3.** The existing magic-byte validation and post-decode `MAX_IMAGE_BYTES` check remain as a defense-in-depth (the estimate is a lower bound; the real decode is the authoritative check).
- **R4.** No behavior change for valid images under the limit.

## Fix

Add a helper `base64DecodedLength(data: string): number` (handle `=` padding) and check it against `MAX_IMAGE_BYTES` before the `Buffer.from` call in `extract-image.ts`. If over, return the existing oversized rejection result without decoding.

## Acceptance Criteria

- [ ] **AC1.** An argus response with a base64 payload whose estimated decoded size exceeds `MAX_IMAGE_BYTES` is rejected without `Buffer.from` ever allocating the full buffer.
- [ ] **AC2.** A valid image under the limit is processed exactly as before (magic-byte validation, storage path, result shape unchanged).
- [ ] **AC3.** The post-decode `MAX_IMAGE_BYTES` check is still present (defense-in-depth).
- [ ] **AC4.** Unit test for the early-reject path (oversized base64) added; `pnpm test` passes.
- [ ] **AC5.** `pnpm --filter @iris/prices typecheck` and lint pass.

## Out of Scope

- Streaming/progressive decode (Node buffers are the contract here).
- Changing `MAX_IMAGE_BYTES`.

## Risks / Technical Notes

- Base64 length → byte length estimate: `Math.floor((data.length * 3) / 4)` then subtract padding count (`=` at end). Slight over-estimate is safe (we reject early); under-estimate is caught by the post-decode check.
- Do not strip whitespace/newlines before measuring unless the decoder would too; match `Buffer.from(data, "base64")` whitespace tolerance (Node tolerates whitespace in base64 since v16).
