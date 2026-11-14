# DR Memoriser

Drill every domino reduction case with an optimal length up to 6 moves. Spaced review or one-pass recap, a draggable 3D cube
(cubing.js), and progress kept in an on-device SQLite database (SQLite WASM, OPFS). Works offline and installs to a phone's
home screen.

Static site, no build step. Serve the folder with any static server, or use GitHub Pages.

- `data/cases.json`: 2,926 cases (class, optimal length, one optimal solution each).
- `lib/`: vendored cubing.js bundle, SQLite WASM, and the cube model used to list all optimal solutions for a scramble.
- Back up your progress from the settings drawer before deleting the app or clearing site data.
