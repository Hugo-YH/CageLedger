# Ant Design CLI 查询参考

## 1. Writing antd component code

Query the API when adding an unfamiliar prop or diagnosing version-specific behavior.

```bash
# Check what props are available
./node_modules/.bin/antd info Button --format json

# Get a working demo as starting point
./node_modules/.bin/antd demo Button basic --format json

# Check semantic classNames/styles for custom styling
./node_modules/.bin/antd semantic Button --format json

# Check component-level design tokens for theming
./node_modules/.bin/antd token Button --format json

# Get the overall design language (design.md): colors, typography, spacing, radius + principles
./node_modules/.bin/antd design.md --format json
```

## 2. Looking up full documentation

When you need comprehensive component docs (not just props):

```bash
./node_modules/.bin/antd doc Table --format json        # full markdown docs for Table
./node_modules/.bin/antd doc Table --lang zh            # Chinese docs
```

## 3. Debugging antd issues

When code isn't working as expected or the user reports an antd bug:

```bash
# Collect full environment snapshot (system, deps, browsers, build tools)
./node_modules/.bin/antd env --format json

# Check if the prop exists for the user's ./node_modules/.bin/antd version
./node_modules/.bin/antd info Select --version 5.12.0 --format json

# Check if the prop is deprecated
./node_modules/.bin/antd lint ./src/components/MyForm.tsx --format json

# Diagnose project-level configuration issues
./node_modules/.bin/antd doctor --format json
```

## 4. Migrating between versions

When the user wants to upgrade antd (e.g., v3 → v4 or v4 → v5):

```bash
# Get full migration checklist
./node_modules/.bin/antd migrate 3 4 --format json    # v3 → v4
./node_modules/.bin/antd migrate 4 5 --format json    # v4 → v5

# Check migration for a specific component
./node_modules/.bin/antd migrate 4 5 --component Select --format json

# Generate agent-friendly auto-migration prompt (does not modify files)
./node_modules/.bin/antd migrate 4 5 --apply ./src --format json

# See what changed between two versions
./node_modules/.bin/antd changelog 4.24.0 5.0.0 --format json

# See changes for a specific component
./node_modules/.bin/antd changelog 4.24.0 5.0.0 Select --format json
```

## 5. Analyzing project antd usage

When the user wants to understand how antd is used in their project:

```bash
# Scan component usage statistics
./node_modules/.bin/antd usage ./src --format json

# Filter to a specific component
./node_modules/.bin/antd usage ./src --filter Form --format json

# Lint for best practice violations
./node_modules/.bin/antd lint ./src --format json

# Check only specific rule categories
./node_modules/.bin/antd lint ./src --only deprecated --format json
./node_modules/.bin/antd lint ./src --only a11y --format json
./node_modules/.bin/antd lint ./src --only performance --format json
```

## 6. Checking changelogs and version history

When the user asks about what changed in a version:

```bash
# Specific version changelog
./node_modules/.bin/antd changelog 5.22.0 --format json

# Version range (both ends inclusive)
./node_modules/.bin/antd changelog 5.21.0..5.24.0 --format json
```

## 7. Exploring available components

When the user is choosing which component to use:

```bash
# List all components with categories
./node_modules/.bin/antd list --format json

# List components for a specific ./node_modules/.bin/antd version
./node_modules/.bin/antd list --version 5.0.0 --format json
```

## 8. Collecting environment info

When you need to understand the project's antd setup, or prepare info for a bug report:

```bash
# Full environment snapshot (text — paste into GitHub Issues)
./node_modules/.bin/antd env

# Structured JSON for programmatic use
./node_modules/.bin/antd env --format json

# Scan a specific project directory
./node_modules/.bin/antd env ./my-project --format json
```

Collects: OS, Node, package managers (npm/pnpm/yarn/bun/utoo), npm registry, browsers, core deps (antd/react/dayjs), all `@ant-design/*` and `rc-*` packages, and build tools (umi/vite/webpack/typescript/etc.).
