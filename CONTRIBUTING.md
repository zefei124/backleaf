# Contributing to Backleaf

Thanks for helping improve Backleaf. Bug reports, focused feature proposals, documentation fixes, and tested pull requests are welcome.

## Before you start

- Search the existing issues before opening a new one.
- For behavior changes, describe the reading workflow and the expected result.
- Keep pull requests focused. Avoid unrelated refactors in the same change.
- Never include API keys, vault contents, personal file paths, or other private data in issues, fixtures, screenshots, or commits.

## Development setup

Backleaf requires a current Node.js LTS release and npm.

```bash
npm install
npm run build
npm test
```

The production plugin files are generated at the repository root:

- `main.js`
- `manifest.json`
- `styles.css`

## Pull requests

Before opening a pull request:

1. Run `npm test` and confirm the full suite passes.
2. Test the affected workflow in Obsidian when the change touches UI, PDF selection, settings, file writes, or navigation.
3. Explain what changed, why it changed, and how it was verified.
4. Update user-facing documentation when behavior or privacy implications change.

By contributing, you agree that your contribution may be distributed under the repository's MIT License.
