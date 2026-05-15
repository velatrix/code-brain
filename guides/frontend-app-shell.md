---
type: guide
title: Frontend App Shell
created: 2026-05-15
updated: 2026-05-15
tags: [frontend]
---

## Default tech stack

Unless the user specifies otherwise, build with:

- **Vue 3** + **TypeScript** — `<script setup>` SFCs, strict TS
- **Tailwind CSS** — utility-first styling
- **Naive UI** — Vue component library (inputs, buttons, dialogs, dropdowns, etc.)
- **Pinia** — state store
- **Vue Router** — client-side routing
- **VeeValidate** + **`@vee-validate/zod`** + **Zod** — form validation against Zod schemas

---

## File structure

Module-based (feature-based), not flat by file type. Each domain owns its components, pages, stores, schemas, and API call wrappers. Cross-module concerns split between `lib/` (external library wiring) and the `core` module (our own shared code).

```
src/
├── main.ts
├── App.vue
├── theme.ts                   # Naive UI themeOverrides + color tokens (consumed by App.vue)
├── router.ts                  # createRouter, routes, guards
├── lib/                       # external library setup, instances, configs
│   ├── http.ts                # ApiClient, ApiError
│   └── i18n.ts                # vue-i18n instance; glob-loads modules/*/i18n
└── modules/
    ├── core/                  # base module — our own shared code
    │   ├── components/        # generic primitives (EmptyState, ConfirmDialog, ...)
    │   ├── composables/       # useDebounce, useClipboard, ...
    │   ├── layouts/           # AppLayout, AuthLayout, AppHeader, UserMenu
    │   └── i18n/              # shared strings (cancel, save, nav items, header items)
    │       ├── en.json
    │       └── tr.json
    ├── auth/
    │   ├── components/        # LoginForm, RegisterForm, ...
    │   ├── pages/             # LoginPage, RegisterPage, VerifyEmailPage, ...
    │   ├── stores/            # useAuthStore
    │   ├── composables/       # useAuth, ...
    │   ├── schemas/           # loginSchema, registerSchema, ...
    │   ├── api/               # auth-specific API call wrappers (uses lib/http)
    │   └── i18n/              # auth-specific strings
    │       ├── en.json
    │       └── tr.json
    ├── account/
    │   └── ...
    └── ...                    # friends, lobbies, dashboard (future)
```

### Rules

- **Modules are self-contained.** Components, pages, stores, schemas, composables, API call wrappers, and i18n strings all live in the module's folder.
- **No module imports from another module.** If module A reaches into module B, the shared piece moves to `modules/core/` (our shared code) or `lib/` (library wiring).
- **`modules/core/`** holds our own foundational code that crosses module boundaries: generic components, generic composables, layouts, shared i18n strings.
- **`lib/`** holds library wiring and library-shaped utilities: HTTP client setup, router config, i18n instance setup. Anything that's "configure / instantiate / glue an external lib" goes here.
- **`theme.ts`** at `src/` root holds Naive UI `themeOverrides` and global color tokens. Consumed by `App.vue` via `<NConfigProvider>`.
- **Routing is centralized in `src/router.ts`** (at root, next to `main.ts` / `App.vue`). It imports pages directly from each module and defines the full nested route tree. Modules don't define their own route arrays.
- **i18n is centralized in `lib/i18n.ts`** — globs `modules/*/i18n/*.json`, namespaces each module's strings by folder name (so `modules/auth/i18n/en.json` → `t('auth.login.title')`). Modules without i18n strings simply omit the folder.

When a feature grows beyond "a few components" — multiple pages, its own store, distinct domain concepts — promote it to a new module under `modules/`.

---

## Layouts & routing

Layouts and routing are wired together via Vue Router's **nested route** pattern. The router config declares which layout wraps which pages — no layout imports inside pages.

Each archetype has one layout component in `layouts/`:

- **`AppLayout.vue`** — wraps authed pages. Contains the fixed `<AppHeader>`, main content slot, optional sidebar.
- **`AuthLayout.vue`** — wraps auth pages (login, register, verify, reset, complete-profile). Centered, decorative, no app chrome.

### How it's wired

**1. `App.vue` mounts a single top-level `<RouterView />`** (wrapped in global providers — theme, message, dialog, etc.):

```vue
<template>
  <NConfigProvider :theme="theme">
    <NMessageProvider>
      <RouterView />
    </NMessageProvider>
  </NConfigProvider>
</template>
```

**2. Routes declare layouts as parent components with pages as children:**

```ts
const routes = [
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', name: 'home', component: HomePage, meta: { requiresAuth: true } },
      { path: 'settings/profile', name: 'settings-profile', component: SettingsProfilePage, meta: { requiresAuth: true } }
    ]
  },
  {
    path: '/auth',
    component: AuthLayout,
    children: [
      { path: 'login', name: 'login', component: LoginPage, meta: { requiresGuest: true } },
      { path: 'register', name: 'register', component: RegisterPage, meta: { requiresGuest: true } }
    ]
  }
]
```

**3. Each layout has its own `<RouterView />`** where the matched child page renders:

```vue
<!-- AppLayout.vue -->
<template>
  <div class="min-h-dvh bg-canvas">
    <AppHeader />
    <main class="pt-16">
      <RouterView />
    </main>
  </div>
</template>
```

The flow: `App.vue` → top-level `<RouterView />` → matches root path → renders `AppLayout` → inner `<RouterView />` → matches child path → renders `HomePage`. Two views nested: outer picks the layout, inner picks the page.

### Why this shape

- **Declarative.** The router config alone tells you which layout wraps which pages.
- **Pages are content-only.** No `<AppLayout>` wrapper in every template, no layout imports per page.
- **DRY.** Adding a new authed page = one line in the router config; the layout is inherited.
- **Auth guards still work.** A single `router.beforeEach` inspects `meta.requiresAuth` / `meta.requiresGuest` on child routes and redirects:

```ts
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  await auth.ensureFetched()
  if (to.meta.requiresAuth && !auth.isAuthenticated) return { name: 'login' }
  if (to.meta.requiresGuest && auth.isAuthenticated) return { name: 'home' }
})
```

Pages without a parent layout (rare — e.g., a standalone OAuth callback page) become top-level routes alongside the layout parents.

---

## Styling

Styling hierarchy: **Naive UI → Tailwind → `<style scoped>`**. Start left; only fall right when the previous option genuinely can't express what's needed.

- **No inline `style="..."` attributes.** Ever.

- **Naive UI first.** Components, layout, AND typography belong here.
  - Visual primitives (`<NButton>`, `<NInput>`, `<NCard>`, `<NAlert>`, `<NModal>`, `<NSelect>`, `<NTable>`, `<NDropdown>`, `<NPopover>`, ...) — use the component.
  - Layout (`<NSpace>`, `<NGrid>` + `<NGridItem>`, `<NLayout>` family, `<NDivider>`) — use Naive's layout primitives, not raw flex/grid div soup.
  - Typography (`<NText>`, `<NH1>`–`<NH6>`, `<NP>`, `<NUl>`, `<NOl>`, `<NBlockquote>`, `<NCode>`) — use Naive's typography components instead of raw `<h1>` + Tailwind text utilities.
  - Theme via `themeOverrides` on the root `<NConfigProvider>` in `App.vue`. Not by writing CSS.

- **Tailwind second.** Only when Naive UI doesn't express it: custom paddings outside Naive's spacing scale, full-width sizing not exposed as a prop, one-off margins / gaps, container width caps (`max-w-3xl`), absolute positioning, color tokens on non-component elements.

- **`<style scoped>` last.** Genuinely custom design only — SVG-backed backgrounds, custom keyframes, decorative effects with no Naive or Tailwind equivalent.

- **Naive UI defaults first.** Don't override spacing, radii, or sizes via `themeOverrides` unless the design explicitly demands it.

---

## Consistency

Pick one pattern per UI primitive and use it across every page. Inconsistency makes the app feel hacked together — borderless table on one page, bordered card on another; Save on the left here, on the right there; tight padding here, generous there.

- **Page headers** — one structure (eyebrow + title + actions). Same placement, same sizing, same eyebrow treatment across pages of the same archetype.

- **Tables** — one frame across the app. Either every table sits inside a bordered `<NCard>`, or no table does. Same for striped rows, header style, action column position.

- **Buttons** — primary action lives in the same place across pages (typically bottom-right of forms, top-right of page headers). Destructive actions get the same treatment everywhere. Cancel + primary order is the same in every dialog.

- **Spacing & padding** — derive from Naive UI's spacing theme. Reuse the same Tailwind tokens (`p-6`, `gap-4`, `mt-12`) across similar contexts. Don't have card A with `p-4` and card B with `p-8` for no reason.

- **Form dialogs use `<NModal preset="card">`** with three structured zones:
  - **Title** — via the `title` prop.
  - **Body** — form content (default slot).
  - **Actions** — Cancel + primary via the `#action` slot.

  Use the `:segmented` prop (or `<NDivider>` between slots) for dividers between zones — don't draw lines manually. Cancel on the left of the action row, primary on the right (or both right-aligned), consistently.

- **Confirm dialogs** use `useDialog()` (`dialog.warning(...)`, `dialog.error(...)`). Same `positiveText` / `negativeText` wording for the same kind of action.

---

## Component size

A Vue SFC has one job. Logical units get their own file:

- **Dialogs** → own file (`AddUserDialog.vue`, `ConfirmDeleteDialog.vue` — not a section embedded in the page)
- **Substantial forms** (multiple fields, submission logic, branching error handling) → own file (`LoginForm.vue`, not inline in `LoginPage.vue`). Trivial single-input forms can stay inline.
- **Complex form fields** → own file (`UsernameField.vue` if it has live availability checking, debounced API call, etc.)
- **Non-trivial cards** with internal layout or state → own file
- **Reusable page sections** (header, sidebar, footer block, hero) → own file
- **Non-trivial list items** (multi-element, interactive, distinct visual treatment) → own file (`FriendListItem.vue`, `MessageBubble.vue`). A plain text list doesn't need a component.

Rule of thumb: if a page's `<template>` is over ~80 lines, or its `<script setup>` has more than ~5 reactive concerns, split it.

---

## No duplication

If UI, logic, or styling appears in more than one place, extract it:

- **Repeated UI** → shared component
- **Repeated logic** → composable (`useX()` in `composables/`)
- **Repeated constants, types, or config** → shared module (`lib/`, `config/`)

Copy-paste means future-you will fix one site and forget the others. Extract before the second use.
