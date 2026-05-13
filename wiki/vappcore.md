---
type: wiki-entity
title: VAppCore
created: 2026-05-13
updated: 2026-05-13
aliases: [VAppCore, vappcore]
tags: [entity, library, dotnet, web-api]
version: "2.2.0"
target-framework: net10.0
repo-path: F:\Projects\VAppCore
distribution: nuget-local
---

# VAppCore

User's personal enterprise .NET 10 library for building web APIs. **Default to using it for any new .NET web API the user builds**; check whether it fits before reaching for hand-rolled equivalents.

> Source of truth: `F:\Projects\VAppCore\README.md` (64KB, comprehensive). This page is the higher-level entry — link out to README sections for deep examples.

## What it is

A composable bundle of cross-cutting concerns for CRUD-heavy web APIs:
- Base entities with audit fields, soft delete, multi-tenancy
- Authentication/authorization with claims or DB-backed permissions
- RSQL query parsing with field-level whitelisting
- Cursor and offset pagination with optional AES-GCM encryption
- Transactional outbox for domain events
- Per-entity audit log with JSONB diffs
- API key authentication for service-to-service calls
- Optimistic concurrency (RowVersion or Postgres xmin)
- Rate limiting with tier multipliers and Redis backend
- Structured error hierarchy + middleware + consistent JSON envelope
- Response mapping enforcement (raw entities blocked at runtime)

**Architecture diagram:** [[vappcore-architecture]] (Excalidraw).

## Distribution

- **NuGet only** — consumed from local feed `F:\Packages\C#`. **Never** as `<ProjectReference>`, even on the same machine. Per the project's CLAUDE.md.
- **Current version:** 2.2.0
- **Pack:** `dotnet pack -c Release -o "F:\Packages\C#"` (bump `<Version>` in `VAppCore.csproj` first)
- **Consume:** Add `F:\Packages\C#` to the consuming repo's `nuget.config` as a package source, then `<PackageReference Include="VAppCore" Version="2.2.0" />`
- **Sibling package:** `VAppCore.RateLimiting.Redis` — separate NuGet, opt-in Redis store for rate limiting

## Architecture overview

Wiring is at the **DI/options level** — your `DbContext` inherits whatever it wants (`DbContext`, `IdentityDbContext`, a Cosmos base, etc.). VAppCore is composed in via `UseVAppCore` on `DbContextOptions` and `AddVAppCore` on `IServiceCollection`. No base class lock-in.

```
┌─────────────────────────────────────────────────────┐
│  HTTP pipeline                                      │
│  VRateLimitMiddleware → VExceptionMiddleware → MVC  │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  MVC layer (filters)                                │
│  [VAuthorize] · [UseVQueryParser] · [VRateLimit]    │
│  + VResponseFilter (blocks raw entity returns)      │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Service layer                                      │
│  VService<T, TKey, TUserKey, TTenantKey>            │
│  Auto-injected: Db, CurrentUser, Set                │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│  Persistence                                        │
│  DbContext (any base)                               │
│  + VAuditInterceptor                                │
│  + OutboxInterceptor (optional)                     │
│  + ConcurrencyConflictInterceptor (optional)        │
│  + AuditLog interceptor (optional)                  │
│  + Global filters: soft-delete, tenant              │
└─────────────────────────────────────────────────────┘
                          ↓
                    [ Postgres ]
```

Plus background workers when enabled: `OutboxProcessor` (polls outbox table, dispatches `IDomainEventHandler<T>`).

## Entity foundation

`VEntity<TKey, TUserKey, TTenantKey>` is the base for all entities. Audit fields and Id, nothing else.

```csharp
public abstract class VEntity<TKey, TUserKey, TTenantKey>
{
    public TKey Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public TUserKey CreatedBy { get; set; }
    public TUserKey UpdatedBy { get; set; }
}
```

**Project-level alias pattern** — define once per project, never re-type generics:

```csharp
public abstract class AppEntity : VEntity<Guid, Guid, Guid> { }
public class Product : AppEntity { ... }
```

### Opt-in interfaces (mix into any entity)

| Interface | Effect |
|---|---|
| `ISoftDeletable` | `Remove()` → `IsDeleted = true` + `DeletedAt` (+ optional `DeletedBy`). Global query filter excludes from normal queries; `IgnoreQueryFilters()` to see them. |
| `ITenantScoped<TTenantKey>` | `TenantId` auto-assigned on Add from current user; global query filter scopes queries (only if DbContext implements `IVTenantContext<TTenantKey>`) |
| `IConcurrent` | Adds `byte[] RowVersion` token; conflicts surface as 409 `ConflictError` (cross-provider) |
| `IConcurrentXmin` | Postgres-native variant using `xmin` system column (no extra column needed) |
| `IAuditedEntity` | Marks for the audit log; `[NotAudited]` on individual properties excludes them from diffs |

An entity can mix any subset. `Product : AppEntity, ISoftDeletable, ITenantScoped<Guid>, IConcurrent, IAuditedEntity` is valid.

## DbContext setup

**Plain `DbContext`, no inheritance from VAppCore.** All wiring through `UseVAppCore`:

```csharp
services.AddDbContext<AppDbContext>((sp, options) =>
{
    options.UseNpgsql(connStr);
    options.UseVAppCore<AppDbContext, Guid, Guid>(sp);  // wires interceptor + filters
});
```

`UseVAppCore` does two things:
1. Adds `VAuditInterceptor` (audit fields, soft delete, tenant assignment on `SaveChanges`)
2. Replaces `IModelCustomizer` to call `ApplyVAppCoreFilters` after your `OnModelCreating`

**Identity case** — works without changes; `IdentityDbContext` keeps owning AspNet* tables, VAppCore audits everything else:

```csharp
public class ApplicationDbContext : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid> { ... }
```

**Multi-tenancy** — implement `IVTenantContext<TTenantKey>` on your `DbContext` to enable the tenant global filter (otherwise `TenantId` is auto-set on Add but no filter is applied).

### Transactions: `TransactionAsync`

Wraps an operation in a transaction; reuses existing transaction if already inside one. No nesting issues. Lets you compose services without worrying about "is there already a transaction":

```csharp
await Db.TransactionAsync(async () =>
{
    Set.Add(order);
    await SaveAsync();
    await _stock.Reduce(...);  // calls SaveAsync internally; same transaction
});
```

## Authentication & Authorization

### `ICurrentUser`

The auth abstraction. Properties: `UserId`, `TenantId`, `Email`, `Roles`, `Permissions`, `IsAuthenticated`, `AuthenticationType`. Methods: `IsInRole`, `HasPermission`.

Default implementation `ClaimsCurrentUser` reads from `ClaimsPrincipal` (works with JWT, Cookie, OIDC, Identity).

### Claims configuration

```csharp
services.AddVAppCore<AppDbContext, Guid, Guid>(o =>
{
    o.UserIdClaim = "sub";              // default — OIDC convention
    o.TenantIdClaim = "tenant_id";
    o.RoleClaim = ClaimTypes.Role;
    o.PermissionClaim = "permission";
    o.EmailClaim = "email";
});
```

### `UseAspNetIdentity` preset

ASP.NET Identity cookies use `ClaimTypes.NameIdentifier` instead of OIDC's `sub`. The preset switches the three relevant defaults in one call — no Identity package dependency added:

```csharp
services.AddVAppCore<ApplicationDbContext, Guid, Guid>(o => o.UseAspNetIdentity());
```

### `IPermissionResolver` — DB-backed permissions

If roles/permissions live in the database (not JWT claims), implement `IPermissionResolver<TUserKey>`. When registered, `ClaimsCurrentUser` calls the resolver instead of reading claims. Results cached per-request.

### `[VAuthorize]` attribute

MVC filter, stackable (multiple attributes = AND):

```csharp
[VAuthorize]                                            // requires auth
[VAuthorize(Permission = "products.create")]            // requires permission
[VAuthorize(Role = "Admin")]                             // requires role
[VAuthorize(Role = "Admin"), VAuthorize(Permission="...")]  // both
[VAuthorize(ApiKey = "matches.report")]                 // API key with permission
```

Unauthorized → 401, forbidden → 403, both in the standard error envelope. No attribute = public endpoint.

## VService

Base service with auto-injected `Db`, `CurrentUser`, `Set`. Constructor-less for simple services; primary constructors for those with extra deps.

```csharp
public abstract class AppService<T> : VService<T, Guid, Guid, Guid>
    where T : AppEntity { }

public class ProductService : AppService<Product>
{
    public Task<Product> Create(CreateProductDto dto)
    {
        var p = new Product { Name = dto.Name };
        Set.Add(p);
        await SaveAsync();
        return p;
    }
}

services.AddVServices(typeof(Program).Assembly);   // scan-register
```

**Built-in methods:**

| Method | Behavior |
|---|---|
| `GetByIdAsync(id, q?)` | Returns entity or throws `NotFoundError` (404) |
| `FindByIdAsync(id, q?)` | Returns entity or `null` |
| `GetPagedAsync(parser, q?)` | Runs the parser against `Set` (or scoped query) — returns `VPagedResponse<T>` |
| `DeleteAsync(id)` | Soft or hard depending on `ISoftDeletable`; throws 404 if not found. Overridable. |
| `SaveAsync()` | Shortcut for `Db.SaveChangesAsync()` |

## RSQL query parsing & `VQueryFilter`

Reads `filter`, `sort`, `select`, `cursor`/`before`, `page`, `limit` from query string. RSQL filter syntax (e.g. `name==John;age=gt=25,status=in=(Active,Pending)`).

**Operators:** `==`, `!=`, `=gt=`, `=ge=`, `=lt=`, `=le=`, `=in=`, `=out=`, `=like=`, `=ilike=`, `=isnull=`, `=isnotnull=`. AND is `;`, OR is `,`, parentheses override precedence.

**Like patterns:** `*val*` (contains), `val*` (starts), `*val` (ends), `*v*l*` (regex).

### `VQueryFilter<T>` whitelist

Without a filter, all fields are exposed. **In practice, always define one** to prevent leaking `internalScore`, `passwordHash`, etc.

```csharp
public class ProductFilter : VQueryFilter<Product>
{
    public ProductFilter()
    {
        Field(x => x.Id).Filterable().Sortable().Selectable();
        Field(x => x.Name).Filterable().Sortable().Selectable().WithAlias("title");
        Field(x => x.Price).Filterable().Sortable();
        Field(x => x.Category.Name).Filterable().Selectable();        // nested
        CollectionField(x => x.Tags, t => t.Name).Filterable();        // collection

        CustomField("author")                                          // nav projection
            .FromNavigation("CreatedByUser")
            .SubField("Id", "id").SubField("Username", "username")
            .Selectable();

        CustomField("orderCount").CountOf("Orders").Selectable().Sortable();
        CustomField("hasDiscount").WithNullCheck("Discount").Filterable();
        CustomField("fullName").WithExpression("it.FirstName + \" \" + it.LastName").Selectable();

        SetDefaultSort("-createdAt");
        SetDefaultSelect("id", "name", "price", "createdAt");

        EnablePageNavigation();   // opt-in to ?page=N (offset mode)
    }
}
```

Apply via attribute:

```csharp
[HttpGet, UseVQueryParser<ProductFilter>]
public async Task<IActionResult> GetAll(VQueryParser parser)
    => Ok(await products.GetPagedAsync(parser));
```

Disallowed fields → HTTP 422 with the list of allowed fields.

### Pagination modes

`GetPagedAsync(parser)` picks the mode by request:

| Request | Mode | Notes |
|---|---|---|
| (no pagination params) or `?cursor=X` | **Cursor (forward)** | Fast keyset query, no COUNT |
| `?before=X` | **Cursor (backward)** | Returns rows in display order, before cursor |
| `?page=N` | **Offset** | Only if filter opted in via `EnablePageNavigation()`, else 400 |

Response shape is unified `VPagedResponse<T>` for both modes; cursor mode has `nextCursor`/`previousCursor`, offset mode adds `page`/`totalItems`/`totalPages`.

**Cursor encryption** — `o.CursorEncryptionKeys = [key1, key2]` enables AES-GCM with key rotation. KMS / Key Vault via custom `ICursorProtector` in DI before `AddVAppCore`.

**Cursor + `CustomField` sorts** — rejected with 400 in cursor mode (the computed expression can't be reproduced in the cursor WHERE clause). Use offset mode for computed-field sorts.

## Domain events + Outbox

Transactional outbox pattern. Events raised on entities, persisted to `OutboxMessages` in the same transaction as the entity, dispatched by a background poller. At-least-once delivery — **handlers must be idempotent.**

```csharp
public record UserRegistered(Guid UserId, string Email) : IDomainEvent;

public class SendWelcomeEmail : IDomainEventHandler<UserRegistered>
{
    public Task Handle(UserRegistered evt, EventContext ctx, CancellationToken ct)
        => _email.SendWelcomeAsync(evt.Email);
}

// Raise:
user.RaiseEvent(new UserRegistered(user.Id, user.Email));
await Db.SaveChangesAsync();

// Wire:
services.AddVAppCoreOutbox<AppDbContext>(o => { o.PollInterval = 2s; o.MaxAttempts = 10; ... });
services.AddDomainEventHandlers(typeof(Program).Assembly);
```

Failed deliveries → exponential backoff → dead-letter after `MaxAttempts`. Sent rows pruned per `RetentionDays`.

Two patterns for cross-aggregate writes:
- **A — eventual**: each related write is its own handler (consumers can lag)
- **B — synchronous**: call related services from inside `TransactionAsync`, raise events only for *external* side effects

## Audit log

Per-entity history with field-level JSONB diffs, in the same transaction as the change.

```csharp
public class Lobby : VEntity<Guid, Guid, Guid>, IAuditedEntity
{
    public string Name { get; set; } = null!;
    [NotAudited] public DateTimeOffset LastSeenAt { get; set; }   // excluded from diff
}

services.AddVAppCoreAuditLog<HubDbContext, Guid, Guid>();
opts.AddVAppCoreAuditInterceptors<HubDbContext, Guid, Guid>(sp);  // AFTER UseVAppCore
```

**Order matters:** `UseVAppCore` must come before `AddVAppCoreAuditInterceptors`, so the audit interceptor sees post-transform state (e.g. soft delete shows as `Action=Delete`, not `Action=Modify` with `isDeleted` flip).

`IAuditLog.GetHistoryAsync<T>(entityId)` returns rows newest-first. `audit.Suppress()` disables for bulk imports.

**Caveats:** owned entities (`OwnsOne`/`OwnsMany`) aren't in parent diffs; lazy-loading proxies record proxy type names (not entity names) — avoid lazy proxies on `IAuditedEntity` types.

## API key auth

Service-to-service via `X-Api-Key` header. SHA-256 hashed, scoped (permissions), revocable, expiring. Plaintext shown ONCE on create/rotate. Plaintext format: `vk_live_<43 base64url chars>`.

```csharp
services.AddVApiKeyAuth<HubDbContext>();
services.AddAuthentication()
    .AddCookie()           // user auth
    .AddVApiKey();         // service auth

// Restrict an endpoint to API key callers (rejects user cookies with 403):
[VAuthorize(ApiKey = "matches.report")]
```

`IApiKeyService` exposes `CreateAsync`, `RevokeAsync`, `RotateAsync`. `LastUsedAt` updated fire-and-forget (doesn't block requests).

## Optimistic concurrency

Either `IConcurrent` (cross-provider `RowVersion`) or `IConcurrentXmin` (Postgres `xmin`, no extra column).

```csharp
services.AddVAppCoreConcurrency(o => o.LogConflicts = true);
opts.AddInterceptors(sp.GetRequiredService<ConcurrencyConflictInterceptor>());
```

On `DbUpdateConcurrencyException`:
1. Interceptor catches
2. All `IConcurrencyConflictObserver`s notified (metrics, OpenTelemetry, alerts)
3. `ConflictError` thrown with metadata `{ kind: "concurrent_update", entityType, entityId }`
4. Middleware → HTTP 409

**Helpers:**
- `Db.RetryOnConflictAsync(action)` — retries on conflict (clears change tracker, re-reads). Default 3 attempts. Right for idempotent read-modify-save (counters, score updates).
- `Db.SaveChangesIgnoreConcurrencyAsync()` — force last-write-wins. Use sparingly; usually a bug, not a feature.

## Rate limiting

Token bucket, per-user partitioning, default policies, tier multipliers, observable.

```csharp
services.AddVAppCoreRateLimiting(o =>
{
    o.LogRejections = true;
    o.TierMultipliers["paid"] = 10;
    o.TierMultipliers["admin"] = double.MaxValue;   // unlimited
});
app.UseVRateLimiting();   // after UseRouting, before MapControllers
```

**Default policies** (override via `o.Policies[name] = new RateLimitPolicy(...)`):

| Policy | Limit | For |
|---|---|---|
| `VAppCoreRateLimitPolicies.Auth` | 5/min | login, register, forgot-password |
| `VAppCoreRateLimitPolicies.Mutation` | 60/min | POST/PUT/DELETE on user data |
| `VAppCoreRateLimitPolicies.Read` | 300/min | GET endpoints |

**Apply:** `[VRateLimit(policy, Cost = N)]` on action/controller.

**Partitioner:** default is `user-{id}` for authenticated, `ip-{remoteIp}` for anonymous. Override via custom `IRateLimitPartitioner`.

**Tier multipliers:** keyed by role; highest match applied to capacity AND refill rate.

**Rejection:** HTTP 429 with `Retry-After` header + standard error envelope (`metadata.kind = "rate_limited"`).

**Distributed:** swap `MemoryRateLimitStore` for `VAppCore.RateLimiting.Redis` (separate NuGet) — atomic Lua script, multi-instance safe.

## Error handling

`BaseError` hierarchy, each with fixed status code:

| Error | Status |
|---|---|
| `ValidationError` | 422 |
| `NotFoundError` | 404 |
| `BadRequestError` | 400 |
| `UnauthorizedError` | 401 |
| `ForbiddenError` | 403 |
| `ConflictError` | 409 |
| `BusinessError` | 500 |
| `SystemError` | 500 |

All take an `ErrorObject { Message, MessageKey, Metadata }`. `MessageKey` is the i18n key consumers should branch on.

`VExceptionMiddleware` (registered via `UseVAppCore()`, call early in pipeline) converts everything to the standard envelope:

```json
{
  "title": "Not Found Error",
  "titleKey": "server.errors.missingResource",
  "error": {
    "message": "Product not found",
    "messageKey": "products.errors.notFound",
    "metadata": { "productId": "abc-123" }
  }
}
```

ASP.NET model validation errors auto-converted to 422 in the same shape.

## Response mapping

`VResponse.Map(entity, dto)` and `VResponse.MapList(entities, dto)` enforced by `VResponseFilter` (MVC filter): **raw entity returns are blocked at runtime.** Either wrap in `VResponse.Map` / `MapList`, or return `VPagedResponse<T>` from `GetPagedAsync` (exempt).

This prevents accidentally serializing internal entity fields. The filter rejects the response and surfaces a configuration error.

## Compatibility & constraints

| Item | Detail |
|---|---|
| **Target framework** | `net10.0` (per README header; current 2.x line) |
| **EF Core** | Tracks .NET 10 — bump VAppCore if the consuming app moves EF Core majors |
| **Distribution** | NuGet from `F:\Packages\C#` only; never `<ProjectReference>` |
| **DbContext base** | Any — `DbContext`, `IdentityDbContext`, custom. Wiring is at options level (v1.1+; before that `VDbContext` inheritance was required — that path is gone). |
| **MVC vs Minimal APIs** | `[VAuthorize]`, `[UseVQueryParser]`, `[VRateLimit]`, `VResponseFilter` are MVC filters. **Minimal APIs lose all four.** Use controllers for any VAppCore-backed endpoint. |
| **Multi-tenancy filter** | Requires `IVTenantContext<T>` on your `DbContext`. Without it, `TenantId` is still auto-assigned on Add but no global filter is applied. |
| **Audit log interceptor order** | Must come AFTER `UseVAppCore` so it reads post-transform state (soft deletes become `Action=Delete`, not `Modify`). |
| **Outbox handlers** | At-least-once delivery — handlers MUST be idempotent. `EventContext.MessageId` is the idempotency key. |
| **Lazy loading + audit log** | Lazy proxies record proxy type names; avoid `UseLazyLoadingProxies` on `IAuditedEntity` types. |
| **Cursor pagination + computed fields** | `CustomField` sort + cursor mode → 400. Use offset mode (`EnablePageNavigation()`) for those sorts. |

## Patterns

### Project setup checklist (greenfield)

1. NuGet feed: `nuget.config` includes `F:\Packages\C#`
2. `csproj`: `<PackageReference Include="VAppCore" Version="2.x.0" />`
3. Define `AppEntity : VEntity<Guid, Guid, Guid>` and `AppService<T> : VService<T, Guid, Guid, Guid>` aliases
4. `Program.cs`:
   - `AddDbContext` with `UseNpgsql + UseVAppCore<TDb, Guid, Guid>(sp)`
   - `AddVAppCore<TDb, Guid, Guid>(o => o.UseAspNetIdentity?())`
   - `AddVServices(assembly)`
   - `UseVAppCore()` early in pipeline
5. Optional features wired separately: `AddVAppCoreOutbox`, `AddVAppCoreConcurrency`, `AddVAppCoreAuditLog`, `AddVAppCoreRateLimiting`, `AddVApiKeyAuth`

### Always define a `VQueryFilter<T>`

Without it, RSQL exposes every property. Even for "simple" APIs, this leaks internals (e.g. `PasswordHash`). Treat the filter as a security boundary.

### Compose, don't extend

VAppCore is wired through options and DI. Resist the urge to subclass `VService` deeper than your `AppService<T>` alias unless you genuinely need shared behavior. Inject collaborators via primary constructors instead.

### Use `TransactionAsync` from outer service, `SaveAsync` from inner

```csharp
await Db.TransactionAsync(async () => {
    Set.Add(...);
    await SaveAsync();        // inner — no transaction concerns
    await _other.DoStuff();   // calls its own SaveAsync; same tx
});
```

`SaveAsync` from inner services participates in outer transactions automatically — no awareness needed.

## Anti-patterns

- **Inheriting `VDbContext`** — that class is gone (v1.1+). Plain `DbContext` + `UseVAppCore`.
- **Returning raw entities from controllers** — `VResponseFilter` blocks it at runtime. Use `VResponse.Map`/`MapList` or `VPagedResponse<T>`.
- **Building a Minimal API on top of VAppCore** — you lose the MVC filters (`VAuthorize`, query parser, rate limit, response filter). Use controllers.
- **Mixing EF Core majors** — pinning constraint is real. Bump VAppCore first to the EF Core major you need.
- **Non-idempotent outbox handlers** — at-least-once delivery means a handler can run twice. Idempotent by design, or use `EventContext.MessageId` as a dedup key.
- **`UseLazyLoadingProxies` on `IAuditedEntity` types** — audit log records proxy type names instead of entity names.

## Related

- [[karpathy-llm-wiki|Karpathy LLM Wiki Pattern]] — informs how *this page* was created (LLM-maintained synthesis)
- _Forthcoming wiki concepts to extract:_ RSQL filter syntax, transactional outbox pattern, cursor pagination, optimistic concurrency, token bucket rate limiting

## Sources

- Primary: `F:\Projects\VAppCore\README.md` (v2.2.0)
- Roadmap: `F:\Projects\VAppCore\ROADMAP.md`
- Distribution policy: `F:\Projects\VAppCore\CLAUDE.md`
- Source root: `F:\Projects\VAppCore\VAppCore\src\`
- Tests: `F:\Projects\VAppCore\VAppCore.Tests\`
