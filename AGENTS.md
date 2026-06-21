# Agent Instructions — 01 Academy CRM UI/UX Standard

> This file defines the design system, reusable UX components, and page-building conventions for the 01 Academy CRM. **All new pages, features, and components must follow these rules.**

---

## Table of Contents
1. [Architecture & Tech Stack](#architecture--tech-stack)
2. [Design Language](#design-language)
3. [Layout & Navigation](#layout--navigation)
4. [Page Structure](#page-structure)
5. [Data Display](#data-display)
6. [Forms & Inputs](#forms--inputs)
7. [Loading, Empty & Error States](#loading-empty--error-states)
8. [Modals & Drawers](#modals--drawers)
9. [Charts & Analytics](#charts--analytics)
10. [Internationalization](#internationalization)
11. [Accessibility](#accessibility)
12. [Responsive Rules](#responsive-rules)
13. [File & Folder Conventions](#file--folder-conventions)

---

## 1. Architecture & Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Routing**: `wouter`
- **State Management**: `@tanstack/react-query` (TanStack Query)
- **Styling**: Tailwind CSS v3 + CSS variables
- **UI Library**: shadcn/ui (Radix primitives)
- **Charts**: Recharts
- **Animations**: Framer Motion (if needed); otherwise use Tailwind transitions
- **Icons**: Lucide React
- **Theme**: Light / Dark / System via `ThemeProvider`

---

## 2. Design Language

### 2.1 Colors
Use **CSS variables** (defined in `client/src/index.css`). Do not hardcode colors.

| Token | Light mode | Dark mode | Usage |
|-------|-----------|-----------|-------|
| `--background` | `hsl(0, 0%, 100%)` | `hsl(240, 10%, 3.9%)` | Page background |
| `--foreground` | `hsl(222, 47%, 11%)` | `hsl(0, 0%, 98%)` | Primary text |
| `--card` | `hsl(0, 0%, 100%)` | `hsl(240, 10%, 3.9%)` | Card surface |
| `--border` | `hsl(220, 16%, 93%)` | `hsl(240, 3.7%, 15.9%)` | Borders |
| `--primary` | `hsl(221, 83%, 53%)` | same | Primary actions |
| `--slate-500` | muted text | muted text | Secondary text |

**Tone colors for KPI cards, badges, indicators:**
- Blue: `bg-blue-50 text-blue-600`
- Green: `bg-emerald-50 text-emerald-600`
- Amber: `bg-amber-50 text-amber-600`
- Red: `bg-red-50又不是失血过多怎么办？ `bg-red-50 text-red-600`

### 2.2 Shadows
Use the premium shadow scale:
- Cards: default no explicit shadow; on hover use `hover:shadow-md` or `hover-lift` class
- Buttons/Actions: `shadow-primary`, `shadow-lg`
- Modals: `shadow-2xl`

### 2.3 Radius
- Cards: `rounded-xl`
- Buttons: `rounded-lg` or `rounded-full` for icon buttons
- Inputs: `rounded-lg`
- Badges: `rounded-full`

### 2.4 Spacing
- Page padding: `p-6 lg:p-8`
- Max content width: `max-w-[1600px] mx-auto`
- Card inner padding: `p-5` or `p-4`
- Gap between cards: `gap-4` or `gap-5`
- Stack spacing: `space-y-6` or `space-y-5`

---

## 3. Layout & Navigation

### 3.1 App Layout
Use the provided `Layout` component. It includes:
- Sidebar (desktop) / overlay drawer (mobile)
- Sticky Header
- Scrollable main content area

```tsx
import Layout from '@/components/Layout';

<Layout>
  {/* Page content */}
</Layout>
```

### 3.2 Header
The Header (header.tsx) already contains:
- Command Palette trigger (`Cmd+K`) — **do not add duplicate search inputs on pages**
- Theme toggle
- Notifications center
- Messages and user profile

### 3.3 Page Header
Use the `PageHeader` component for consistent page titles:

```tsx
import { PageHeader } from '@/components/ux/PageHeader';

<PageHeader
  title={t('sectionTitle')}
  subtitle={t('sectionDescription')}
  breadcrumbs={[{ label: t('navDashboard'), href: '/' }, { label: t('navLeads') }]}
  actions={<Button>{t('create')}</Button>}
/>
```

### 3.4 Sidebar Navigation
- Sidebar items are auto-generated from nav definitions
- Sections can be collapsed/expanded
- Tooltips show on hover
- Active item has a left indicator dot: `<span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary-600" />`

---

## 4. Page Structure

Every new page must follow this structure:

```tsx
export default function FeaturePage({ section }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({ queryKey: ['/api/feature'] });

  // Loading state
  if (isLoading) return <FeatureSkeleton />;

  // Error state
  if (!data) return <EmptyState title={t('noData')} />;

  return (
    <div className="p-6 lg:p-8 max-w-[1600px] mx-auto">
      <PageHeader title={t('featureTitle')} subtitle={t('featureDesc')} />
      {/* Page content */}
    </div>
  );
}
```

---

## 5. Data Display

### 5.1 Tables
**Always use `DataTable`** instead of raw `<table>`.

```tsx
import { DataTable } from '@/components/ux/DataTable';

const columns = [
  {
    key: 'name',
    header: t('name'),
    sortable: true,
    accessor: (row) => row.name,
    render: (row) => <span>{row.name}</span>,
  },
  // ...
];

<DataTable
  columns={columns}
  data={data}
  keyExtractor={(row) => `item-${row.id}`}
  defaultSortKey="name"
  defaultSortDirection="asc"
  emptyState={<EmptyState title={t('noData')} />}
/>
```

**Rules:**
- Always provide `sortable: true` for columns where it makes sense
- Use `keyExtractor` with a stable unique key
- Provide custom `render` for complex cells
- Use `rowClassName` for styling based on data (e.g., red background for overdue items)

### 5.2 Cards
Use `Card`, `CardHeader`, `CardContent` from shadcn. Patterns:
- **KPI Cards**: Use `KpiCard` component for metrics
- **List Cards**: Card with header + scrollable list inside
- **Action Cards**: Card with header + action buttons in header

### 5.3 Lists & Grids
- Use `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4` for card grids
- Use `space-y-3` for stacked list items inside cards
- Always truncate long text: `truncate` class

---

## 6. Forms & Inputs

### 6.1 Form Layouts
Use grid layouts:
- 1 column: `grid grid-cols-1 gap-3`
- 2 columns: `grid grid-cols-1 md:grid-cols-2 gap-3`
- 3 columns: `grid grid-cols-1 md:grid-cols-3 gap-3`
- 4 columns: `grid grid-cols-1 md:grid-cols-4 gap-3`
- Form label style: `<Label className="text-xs text-slate-500">` (use `Field` helper)

### 6.2 Validation
- Use `react-hook-form` + `zod` for all forms
- Show inline error messages below inputs
- Disable submit button while submitting (`disabled={mutation.isPending}`)
- Show toast on success/error

### 6.3 Select/Date Inputs
- Use shadcn `Select` component
- Date inputs: `<Input type="date" />` or `<Input type="datetime-local" />`
- Use `Field` wrapper for consistent label styling

---

## 7. Loading, Empty & Error States

### 7.1 Loading Skeletons
Use `Skeleton` from shadcn. For full page loading:

```tsx
<div className="p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
  <Skeleton className="h-10 w-64" />
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
  </div>
  <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
    <Skeleton className="h-80" />
    <Skeleton className="h-80 xl:col-span-2" />
  </div>
</div>
```

**Skeleton rules:**
- Match the layout of the actual content
- Use `space-y-6` for vertical spacing
- Use grid for card layouts

### 7.2 Empty States
Use the `EmptyState` component:

```tsx
import { EmptyState } from '@/components/ux/EmptyState'; // or inline

<EmptyState
  title={t('noLeadsFound')}
  text={t('noLeadsFoundDesc')}
  icon={Megaphone}
/>
```

### 7.3 Error States
For error boundaries or API errors:
- Inline error alert: `<Alert variant="destructive">`
- Toast for mutation errors
- Retry button for failed queries: `queryClient.invalidateQueries({ queryKey: [...] })`

---

## 8. Modals & Drawers

### 8.1 Creation/Edit Forms
Use the shared `Dialog` from shadcn. Pattern:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
    <DialogHeader>
      <DialogTitle>{t('createEntity')}</DialogTitle>
      <DialogDescription className="sr-only">{t('createEntityDesc')}</DialogDescription>
    </DialogHeader>
    {/* Form fields */}
  </DialogContent>
</Dialog>
```

### 8.2 Detail Views
Use `Sheet` for side-panel detail views (like `StudentDetailSheet`).

### 8.3 Confirmations
Use `AlertDialog` for destructive actions.

---

## 9. Charts & Analytics

### 9.1 When to use charts
- Revenue trends: Area Chart
- Funnels/comparisons: Bar Chart or horizontal Bar Chart
- Distribution: Pie/Donut Chart

### 9.2 Chart component
Use `DashboardCharts` as reference. Wrap in `Card` with `ResponsiveContainer`.

### 9.3 Chart styling
- Use CSS variables for colors (`var(--primary-500)`, `var(--slate-200)`)
- Always use `ResponsiveContainer` for responsive charts
- Add tooltips with formatted values
- Keep chart height around `h-72`

---

## 10. Internationalization

All user-facing strings must be in `client/src/lib/i18n.ts`.

**Rules:**
- Key naming: camelCase, descriptive
- Always provide both `en` and `ru` translations
- Use existing keys if they exist
- Add new keys at the bottom under the `// UX improvements` comment section

```ts
newFeatureTitle: { en: 'New Feature', ru: 'Новая функция' },
```

**Usage:**
```tsx
const { t } = useTranslation();
<h1>{t('newFeatureTitle')}</h1>
```

---

## 11. Accessibility

- **Focus management**: Visible focus rings (`ring-2 ring-primary-500`)
- **Keyboard navigation**: All interactive elements must be reachable via Tab
- **ARIA labels**: Use `sr-only` text for icon-only buttons
- **Color contrast**: Ensure 4.5:1 minimum for text
- **Reduced motion**: Respect `prefers-reduced-motion`

---

## 12. Responsive Rules

Use this breakpoint system:
- **Mobile**: < 768px (default Tailwind)
- **Tablet**: md: 768px+
- **Desktop**: lg: 1024px+
- **Wide**: xl: 1280px+
- **Ultra-wide**: 2xl: 1536px+

**Common responsive patterns:**
- Tables: `overflow-x-auto` wrapper
- Grids: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
- Sidebars: `hidden md:block`
- Stacked -> Row: `flex-col md:flex-row`

---

## 13. File & Folder Conventions

### 13.1 New Page
Create in `client/src/pages/<feature>/`:
```
pages/
  leads/
    LeadsPage.tsx       # Main page component
    LeadForm.tsx        # Form component (if complex)
    LeadTable.tsx       # Table component (if complex)
```

### 13.2 New Reusable Component
Create in `client/src/components/ux/<ComponentName>.tsx`.

### 13.3 Page Route
Add to `client/src/App.tsx`:
```tsx
<Route path="/feature" component={() => <FeaturePage section="feature" />} />
```

### 13.4 Naming
- Components: PascalCase (`FeaturePage.tsx`)
- Hooks: camelCase (`useFeature.ts`)
- Utils: camelCase (`featureUtils.ts`)
- Types: PascalCase + `Type` suffix (`FeatureType`)

---

## Quick Reference

| Element | Component / Pattern |
|---------|-------------------|
| Page title | `PageHeader` |
| Table | `DataTable` |
| KPI metric | `KpiCard` |
| Search | Command Palette (built into Header) |
| Loading | `Skeleton` |
| Empty state | `EmptyState` |
| Modal form | `Dialog` + `DialogContent` |
| Detail view | `Sheet` |
| Chart | `DashboardCharts` or Recharts directly |
| Theme | `ThemeToggle` (built into Header) |
| Toast | `toast({ title: ..., description: ... })` |
| Confirmation | `AlertDialog` |

---

## Do Not
- Use raw HTML `<table>` — use `DataTable`
- Add duplicate search inputs on pages — use Command Palette
- Inline hardcoded colors — use CSS variables
- Add untranslated strings — use `i18n.ts`
- Skip loading states — always show `Skeleton`
- Skip empty states — always show `EmptyState`
---
-maintainer: 01 Academy CRM
-updated: 2025-06-16
