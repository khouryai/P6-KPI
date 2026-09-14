# Installing T&C Budget as a desktop app (stage 1)

The application is a local web app served from `localhost` by a small Node script and
installed through Edge's "Install this site as an app". It gets a desktop icon, its own
window with no browser chrome, and needs no installer or admin rights. Nothing leaves the
laptop: there is no server other than the one on `127.0.0.1`, no database, no account.

## Prerequisites

- Windows 10 or 11 with Microsoft Edge (or Chrome).
- Node.js 20 or newer on the PATH (`node --version`). Node is a plain user install from
  https://nodejs.org and does not need admin rights when the "for me only" option is used.
- OneDrive signed in, with a folder for the data (suggested: `OneDrive\TC-Budget`).

## First run

1. Copy or clone this repository somewhere permanent, for example `C:\Tools\tc-budget`.
2. Double-click `start.cmd`. The first run installs dependencies and builds the app, which
   takes a minute or two. Later runs start in about a second.
3. Edge opens `http://localhost:47800/` in an app window.
4. Click **Choose the storage folder…** and pick (or create) `OneDrive\TC-Budget`. Grant
   read and write access when Edge asks. The choice is remembered.
5. In File Explorer, right-click the `TC-Budget` folder and choose **Always keep on this
   device**, so OneDrive never replaces a data file with a cloud-only placeholder.
6. Import the current P6 schedule, then the baseline.

## Install as an app and pin it

1. With the app open in a normal Edge tab (`http://localhost:47800/`), open the `…` menu
   → **Apps** → **Install this site as an app** (or click the install icon in the address
   bar).
2. Name it "T&C Budget" and confirm. Edge creates a Start menu entry and a desktop icon and
   opens the app in its own window.
3. Right-click the running app on the taskbar → **Pin to taskbar**.

Edge prompts to install because the app ships a web app manifest and a service worker.
The service worker precaches the built files, so the window opens instantly and works
with no network; there is nothing to sync over the network anyway.

## Keep the server running: logon task

The installed app needs the local server. Register `start.cmd` as a logon task so it is
always up:

1. Open **Task Scheduler** → **Create Basic Task…**
2. Name: `TC Budget server`. Trigger: **When I log on**.
3. Action: **Start a program**. Program: the full path to `start.cmd`.
   Start in: the repository folder.
4. Finish. Optionally open the task's properties and tick **Run with highest privileges**
   off (not needed) and **Hidden** on, so no console window shows.

`start.cmd` is idempotent: if the server is already listening on port 47800 it just opens
the window. If the port is taken by something else, set `TC_PORT` or pass a port as the
first argument to `node server\serve.mjs` and edit `PORT` in `start.cmd`.

Alternatively, without Task Scheduler: place a shortcut to `start.cmd` in
`shell:startup` (Win+R, type `shell:startup`).

## Updating

Pull the new version, delete the `dist` folder, run `start.cmd`. The service worker picks
up the new build on the next open (it versions its cache per build).

## Troubleshooting

- **"This browser cannot open folders"**: the File System Access API needs a secure
  context. `http://localhost` qualifies; opening `dist/index.html` directly (`file://`)
  does not. Always go through the server.
- **Edge asks for folder permission every time**: Edge remembers the folder handle, but
  re-asks for permission after a restart. One click on **Reconnect** grants it again.
  Installing as an app reduces the prompts.
- **Save fails with a OneDrive message**: OneDrive briefly locks files while uploading.
  The app retries five times with backoff. If it still fails, wait a moment and Save again;
  your edits are still in the window.
- **Conflict copy banner**: two machines edited the folder at the same time. Compare the
  named files in Explorer, keep one, delete the other, then **Reload from folder** in
  Settings. The app never merges them.
- **Everything is empty after opening**: the folder may be a cloud placeholder that has
  not downloaded. Mark it "Always keep on this device" and reload.

## Stage 2 (optional, not started): Tauri

Wrapping the same build in Tauri produces a single executable with no server process, but
needs a Rust toolchain, and an unsigned executable trips SmartScreen on a corporate build.
Reach for it only once stage 1 is in use and someone asks.
