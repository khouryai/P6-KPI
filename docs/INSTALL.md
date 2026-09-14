# Installing T&C Budget on a locked-down Windows laptop

**Nothing needs installing.** No Node.js, no npm, no downloads, no admin rights, no
installer for IT to approve. The application is already built and committed to this
repository; Windows itself provides everything needed to run it.

---

## What to copy

Copy the **whole folder** to somewhere permanent on the laptop, for example
`C:\Tools\tc-budget` or a folder in your OneDrive. These are the parts that matter:

| Path | What it is |
| --- | --- |
| `start.cmd` | Double-click this. It starts the app. |
| `dist\` | The built application. |
| `server\serve.ps1` | The local server, written in PowerShell. |
| `standalone\index.html` | The whole app as one file, for when nothing else works. |

Copying only `start.cmd` will not work; it needs `dist\` and `server\` beside it.

---

## First run

1. Double-click **`start.cmd`**.
2. A small server window appears and stays open. Leave it alone; closing it stops the app.
3. Edge opens the app at `http://localhost:47800/`.
4. Choose where your data lives (see **Where your data lives** below). The usual answer is
   **Choose the storage folder…** and then `OneDrive\TC-Budget`.
5. In File Explorer, right-click that folder and pick **Always keep on this device**, so
   OneDrive never turns a data file into a cloud-only placeholder.
6. Go to **Import** and drop in the P6 export.

There is no build step and no wait. `start.cmd` opens the app in about a second.

### Why a server at all?

The app asks the browser for permission to read and write one folder, and browsers only
allow that from a real web address, not from a file on disk. `start.cmd` therefore runs a
tiny server on `127.0.0.1` that nothing outside the laptop can reach. It serves five files
from `dist\` and does nothing else. There is no network traffic of any kind.

---

## Install it as a desktop app and pin it

1. With the app open in a normal Edge tab at `http://localhost:47800/`, open the `…` menu
   → **Apps** → **Install this site as an app**. (There is also an install icon in the
   address bar.)
2. Name it **T&C Budget** and confirm. Edge creates a Start menu entry and a desktop icon,
   and reopens it in its own window with no browser chrome.
3. Right-click it on the taskbar → **Pin to taskbar**.

Edge offers the install because the app ships a web app manifest and a service worker. The
service worker keeps a copy of the app in the browser so the window opens instantly.

---

## Keep the server running: a logon task

The installed app needs the local server. Register `start.cmd` to run at logon:

1. **Task Scheduler** → **Create Basic Task…**
2. Name `TC Budget server`, trigger **When I log on**.
3. Action **Start a program**; Program: the full path to `start.cmd`; Start in: the folder
   containing it.
4. Finish. In the task's properties, tick **Hidden** so no console window appears.

None of this needs admin rights, because the task runs as you.

Simpler alternative: press Win+R, type `shell:startup`, and put a shortcut to `start.cmd`
in the folder that opens.

`start.cmd` is safe to run repeatedly. If the server is already listening it just opens the
window.

---

## Where your data lives

You are asked once, and can change it later in **Settings**.

**A OneDrive folder (recommended).** Plain JSON files in a folder you pick, normally
`OneDrive\TC-Budget`. OneDrive syncs it, backs it up, and keeps version history, so any
file can be rolled back to an earlier point in time. This is approved corporate storage, so
there is nothing for IT to sign off.

**This browser.** If the folder cannot be used, the app stores everything inside the
browser profile on this machine. It survives closing the app and restarting the laptop, but
it is **not** in OneDrive, **not** backed up, and clearing browsing data erases it. If you
use this, take a backup from **Settings → Download a backup** regularly.

Either way you can move everything between machines with **Settings → Download a backup**
and **Restore from a backup**.

---

## If `start.cmd` cannot start a server

Some corporate builds block PowerShell scripts. `start.cmd` tries PowerShell first, then
Python if it happens to be installed, and if neither works it opens
`standalone\index.html` instead.

That standalone file is the entire application in a single HTML file. Double-click it and
it runs. It is a genuine fallback, not a demo: import, budget, curves, snapshots and export
all work. Two differences:

- It saves into the browser rather than a folder, unless the browser lets it ask for the
  folder (Edge usually does; click **Choose the storage folder…** and see whether a picker
  appears). **Take backups from Settings.**
- Edge will not offer "Install this site as an app", because that needs a real address. You
  can still pin the file to the taskbar as a normal shortcut.

You can also copy `standalone\index.html` into your OneDrive folder and open it from there
on any machine.

---

## Updating to a new version

Copy the new `dist\`, `standalone\` and `server\` folders over the old ones and restart
`start.cmd`. Your data is in your storage folder, not in the application, so nothing is
lost. The service worker versions itself per build and picks up the new files on the next
open.

---

## Troubleshooting

**"The built application is missing".** Only `start.cmd` was copied. Copy the whole folder.

**The server window flashes and disappears.** PowerShell is blocked by policy. The app will
have opened `standalone\index.html` instead, which works. If you want the server, ask IT
whether `powershell -ExecutionPolicy Bypass -File` is permitted; the script it runs is
`server\serve.ps1`, which is plain readable text that serves five local files.

**"Could not listen on port 47800".** Something else is using it. Edit `start.cmd` and
change `set "PORT=47800"` to another number above 1024, for example `47801`.

**Edge asks for folder permission every time.** Edge remembers the folder but re-asks for
permission after a restart. One click on **Reconnect** restores it. Installing it as an app
reduces the prompting.

**A save fails with a OneDrive message.** OneDrive briefly locks files while uploading. The
app retries five times with a growing delay. If it still fails, wait a moment and press
**Save** again; nothing is lost, your edits are still in the window.

**A red "conflict copies" banner.** Two machines wrote to the folder at once and OneDrive
kept both versions. The app never merges them. Open the folder, compare the files it names,
keep one, delete the other, then **Settings → Reload**.

**Everything is empty after opening.** The folder may still be a cloud-only placeholder.
Right-click it in Explorer, choose **Always keep on this device**, and reload.

---

## For developers (a machine that does have Node)

```
npm install
npm test               # engine, storage and import-format suites
npm run dev            # dev server with hot reload
npm run build:all      # rebuilds both dist/ and standalone/ — commit the result
npm run serve          # Node version of the local server
TC_WORKBOOK=path\to\TC_P6_Budget_SCurve.xlsx npm test   # parity against the real workbook
```

`dist/` and `standalone/` are committed on purpose: they are the delivered product for a
laptop that cannot build them. Re-run `npm run build:all` and commit the output whenever
you change anything under `src/`.

## Stage 2 (optional, not built): Tauri

Wrapping the same build in Tauri would produce a single .exe with no server process, but it
needs a Rust toolchain to build and an unsigned .exe trips SmartScreen on a corporate
machine. The PowerShell server reaches the same place with nothing to install, so this is
only worth revisiting if someone asks.
