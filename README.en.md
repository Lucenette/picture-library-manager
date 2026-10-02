# Picture Library Manager

> The Chinese documents are authoritative. This is an entry-level English overview; details link back to the Chinese docs.

Turn character images from assorted source directories into a clean, character-grouped dataset ready for training.

## Features

- **Sources**: register multiple image-pack directories, scan them as background tasks, clean up or remove them.
- **Tasks**: scan / pick / export run through a single-concurrency task queue; pause, resume, force-stop, retry, reorder.
- **Characters**: review and rename detected character names, singly or in bulk.
- **Scripting**: a JavaScript engine for custom selection and structure-recognition logic.
- **Groups and library**: browse image groups, pick the final image per group, exclude unwanted ones, export by character.
- **Thumbnails and viewer**: 100x100 WebP thumbnails decoded on worker threads; a dedicated image viewer window.
- **Dark theme**: a JetBrains-style dark UI.

## Tech stack

Electron 44, Vue 3, TypeScript 5, Vite 6, Element Plus 2, `node:sqlite`, sharp (libvips).

## Quick start

Requirements: Node.js >= 22.12, Yarn 1.x. Windows / macOS / Linux all have installers; day-to-day development and verification happen on Windows.

```bash
git clone https://github.com/Lucenette/picture-library-manager.git
cd picture-library-manager
yarn install
yarn dev
```

Build for the current platform with `yarn build` (Windows NSIS, macOS dmg, Linux AppImage / deb).

## Scripting

Scripts are CommonJS `.js` files stored under the user data directory; the app keeps only an index. A script exports named functions such as `identify-structure`, `select-image` and `identify-character`. There is **no sandbox** and scripts run in the main process. See [docs/SCRIPTING.md](docs/SCRIPTING.md) (Chinese).

## Docs

- [README.md](README.md) - the authoritative Chinese README
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - process model, task system, data flow
- [docs/SCRIPTING.md](docs/SCRIPTING.md) - scripting contract and examples
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) - troubleshooting by symptom
- [CONTRIBUTING.md](CONTRIBUTING.md) - how to contribute
- [CHANGELOG.md](CHANGELOG.md) - release notes

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The project works in Chinese; English issues and pull requests are welcome and the maintainer will translate. Starter tasks are labelled `good first issue` on GitHub.

## License

MIT (c) Lucenette
