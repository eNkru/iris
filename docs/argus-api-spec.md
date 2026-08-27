<!--
  Reference copy of the Argus v1 API spec, mirrored from the argus repo
  (../argus/docs/api-spec.md) for convenience. Argus owns this contract —
  the canonical source lives in the argus repo and is the one to update when
  the /v1/* routes change. This copy is a snapshot for iris contributors so
  they don't need to check out argus to see what the external fetch service
  exposes.

  Argus endpoints consumed by iris:
    POST /v1/fetch          — fetch-page.ts        (rendered page HTML)
    POST /v1/extract-price  — extract-price.ts     (price extraction)
    POST /v1/fetch-image    — extract-image.ts     (binary image fetch)
  All require `Authorization: Bearer <token>` (ARGUS_API_TOKEN).
-->
# Argus API specification (v1)

Base URL: `http://<host>:8000`

## Authentication

All `/v1/*` routes require HTTP Bearer auth:

```
Authorization: Bearer <token>
```

`<token>` must be one of the comma-separated values in `ARGUS_API_TOKENS`.
`/health` is unauthenticated. Set `ARGUS_AUTH_DISABLED=true` to bypass (dev).

## OpenAPI 3.1

```yaml
openapi: 3.1.0
info:
  title: Argus
  description: General-purpose anti-detect browser fetch service.
  version: 1.0.0

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: API token
  schemas:
    Cookie:
      type: object
      required: [name, value, domain, path]
      properties:
        name:     { type: string }
        value:    { type: string }
        domain:   { type: string, description: "e.g. '.taobao.com'" }
        path:     { type: string, default: "/" }
        httpOnly: { type: boolean, default: false }
        secure:   { type: boolean, default: false }
        sameSite: { type: string, enum: [Strict, Lax, None], default: Lax }

paths:
  /health:
    get:
      summary: Service readiness
      security: []
      responses:
        "200":
          description: Service is ready. The browser may be lazy/absent by design.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:   { type: string, example: "ok" }
                  browser:  { type: string, enum: [ready, absent] }

  /v1/fetch:
    post:
      summary: Fetch a page's rendered HTML
      security: [bearerAuth: []]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url]
              properties:
                url:            { type: string, format: uri }
                cookies:
                  type: array
                  description: "Cookies injected into the ephemeral context before navigation. Omit for login-free sites."
                  items: { $ref: "#/components/schemas/Cookie" }
                waitUntil:      { type: string, enum: [domcontentloaded, load, networkidle], default: domcontentloaded }
                renderWaitMs:   { type: integer, default: 8000 }
                timeoutMs:      { type: integer, default: 35000 }
                detectBlocked:  { type: boolean, default: true, description: "Run the blocked-signature registry on returned HTML" }
                locale:         { type: string, description: "Optional context locale, e.g. 'en-US', 'zh-CN'" }
                userAgent:      { type: string, description: "Optional context user-agent override (see fingerprint caveat in architecture.md)" }
      responses:
        "200":
          description: Never throws. ok or structured failure.
          content:
            application/json:
              schema:
                oneOf:
                  - type: object
                    properties:
                      ok:   { const: true }
                      html: { type: string }
                      url:  { type: string, format: uri }
                  - type: object
                    properties:
                      ok:        { const: false }
                      reason:    { type: string, enum: [blocked, fetch_failed] }
                      signature: { type: string, description: "Present only when reason=blocked and detectBlocked=true" }
                      retryable: { type: boolean, description: "Present only when reason=blocked; whether a fresh fetch can plausibly pass this block" }

  /v1/extract-price:
    post:
      summary: Fetch a page and extract its product price (JSON-LD first)
      security: [bearerAuth: []]
      description: |
        Navigates to the URL through the shared anti-detect browser, then
        parses the page's JSON-LD (`application/ld+json`) for a schema.org
        Offer/AggregateOffer with a usable price (> 0). On a hit, returns the
        Decimal-normalized price plus the full primary Product node as
        `jsonld` (name/brand/gtin/reviews ride along) — no LLM is invoked.
        On a miss with `aiFallback=true`, an OpenAI-compatible LLM extracts
        `{price, currency, name, available}` from the page (requires the
        `ARGUS_AI_*` settings; unconfigured/degraded AI maps to
        `extraction_failed`). Blocked WAF pages short-circuit BEFORE any LLM
        call and return the signature.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url]
              properties:
                url:            { type: string, format: uri }
                cookies:
                  type: array
                  items: { $ref: "#/components/schemas/Cookie" }
                waitUntil:      { type: string, enum: [domcontentloaded, load, networkidle], default: domcontentloaded }
                renderWaitMs:   { type: integer, default: 8000 }
                timeoutMs:      { type: integer, default: 35000 }
                detectBlocked:  { type: boolean, default: true }
                locale:         { type: string }
                userAgent:      { type: string }
                aiFallback:     { type: boolean, default: true, description: "false = deterministic JSON-LD-only (never invokes the LLM)" }
      responses:
        "200":
          description: Never throws. ok or structured failure.
          content:
            application/json:
              schema:
                oneOf:
                  - type: object
                    properties:
                      ok:           { const: true }
                      source:       { type: string, enum: [jsonld, ai] }
                      url:          { type: string, format: uri, description: "Final URL after redirects" }
                      available:    { type: boolean }
                      price:        { type: string, nullable: true, description: "Decimal-normalized 2dp string, e.g. '599.99'; null when not available" }
                      currency:     { type: string, nullable: true }
                      availability: { type: string, nullable: true, description: "schema.org ItemAvailability URI (source=jsonld only)" }
                      name:         { type: string, nullable: true }
                      jsonld:       { type: object, nullable: true, description: "Primary Product node (source=jsonld only); null for source=ai" }
                  - type: object
                    properties:
                      ok:        { const: false }
                      reason:    { type: string, enum: [blocked, fetch_failed, extraction_failed] }
                      signature: { type: string, nullable: true, description: "Present only when reason=blocked" }
                      retryable: { type: boolean, nullable: true, description: "Present only when reason=blocked" }

  /v1/fetch-image:
    post:
      summary: Fetch a binary image through the browser
      security: [bearerAuth: []]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [url]
              properties:
                url:       { type: string, format: uri }
                cookies:
                  type: array
                  items: { $ref: "#/components/schemas/Cookie" }
                timeoutMs: { type: integer, default: 35000 }
                locale:    { type: string }
                userAgent: { type: string }
      responses:
        "200":
          content:
            application/json:
              schema:
                oneOf:
                  - type: object
                    properties:
                      ok:          { const: true }
                      contentType: { type: string }
                      data:        { type: string, description: "base64-encoded image bytes" }
                  - type: object
                    properties:
                      ok:     { const: false }
                      reason: { type: string, enum: [fetch_failed, non_image] }
```

## Cookie shape

Each cookie mirrors the object a browser devtools "copy all cookies" produces
(and the shape `BrowserContext.add_cookies` accepts), so a Taobao cookie jar can
be pasted verbatim:

```json
[
  { "name": "login5",    "value": "u%3D...", "domain": ".taobao.com", "path": "/", "httpOnly": true,  "secure": true, "sameSite": "Lax" },
  { "name": "_tb_token_", "value": "e3b0...", "domain": ".taobao.com", "path": "/" }
]
```

`httpOnly`, `secure`, `sameSite` are optional (default `false`, `false`, `Lax`).
`name`, `value`, `domain`, `path` are required.
