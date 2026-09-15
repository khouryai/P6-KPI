# Installing T&C Budget on a locked-down Windows laptop

**Nothing needs installing.** No Node.js, no npm, no downloads, no admin rights, no
installer for IT to approve.

There are two ways to run it. They are not better and worse, they are different
trade-offs, and on a laptop where PowerShell is restricted only one of them works.

| | **A. Taskbar app** | **B. Local server** |
| --- | --- | --- |
| Set up with | `Create Desktop App.cmd`, once | `start.cmd` |
| Needs PowerShell to run scripts | No | Yes |
| Anything running in the background | No | Yes, a server window |
| Own window and taskbar icon | Yes | Yes |
| Listed under Edge's installed apps | No | Yes |
| Works offline | Yes | Yes |

**If PowerShell is locked down on your machine, use A.** You lose nothing that
matters: the app is identical, it is just launched from a file instead of from
`localhost`.

---

## What to copy

Copy the **whole folder** somewhere permanent, for example `C:\Tools\tc-budget`, or
a folder in your OneDrive. Copying only one `.cmd` file will not work.

| Path | What it is |
| --- | --- |
| `Create Desktop App.cmd` | Way A. Makes the desktop and taskbar app. |
| `start.cmd` | Way B. Starts the local server and opens the app. |
| `standalone\index.html` | The whole application in one file. |
| `dist\` | The application as separate files, for the server. |
| `server\serve.ps1` | The local server. |

---

## Way A: a taskbar app, no server

1. Double-click **`Create Desktop App.cmd`**. It finds Edge, writes a **TC Budget**
   shortcut to your desktop, and opens the app so you can check it.
2. Right-click the new desktop icon → **Show more options** → **Pin to taskbar**.
3. Click the taskbar icon whenever you want the app. That is the whole routine.

The shortcut runs Edge in app mode:

```
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --app="file:///C:/Tools/tc-budget/standalone/index.html"
```

Edge opens that in its own window with no address bar and its own taskbar button, and
reports itself to the page as a standalone app, exactly as an installed PWA does.

If both automatic methods are blocked by policy, the script prints the exact command
line and also writes it to `taskbar-shortcut-target.txt`. Make the shortcut by hand:
right-click the desktop → **New** → **Shortcut**, paste that line, name it
**TC Budget**, then Properties → **Change Icon** → browse to `public\icon.ico`, then
pin it.

**What you give up.** Edge will not offer "Install this site as an app" and it will
not appear in `edge://apps`. That is a browser rule, not a limitation of this app: a
real PWA install requires an `http://` or `https://` address, which means a server.
The window, the icon and the behaviour are the same either way.

---

## Way B: the local server, and a real PWA install

1. Double-click **`start.cmd`**. A server window opens and stays open.
2. Edge opens the app at `http://localhost:47800/`.
3. To install it properly: open `http://localhost:47800/` in a **normal Edge tab**,
   then `…` → **Apps** → **Install this site as an app**. Name it **T&C Budget**.
4. Right-click it on the taskbar → **Pin to taskbar**.

### Do I have to run start.cmd every time?

With Way B, yes: the app is served by that server, so something has to be running.
But you never have to think about it if you make it start with Windows:

1. **Task Scheduler** → **Create Basic Task…**
2. Name `TC Budget server`, trigger **When I log on**.
3. Action **Start a program**; Program: the full path to `start.cmd`; Start in: the
   folder containing it.
4. Finish, then open the task's properties and tick **Hidden**.

None of that needs admin rights. `start.cmd` is safe to run repeatedly: if the server
is already listening it just opens the window.

With Way A there is nothing to run at all. Click the taskbar icon.

---

## "Do you want to run this script?" with [D] Do not run, [R] Run once

This is Windows telling you `serve.ps1` is a script that came from somewhere else.
Two separate things cause it:

- **The mark of the web.** A file copied from OneDrive, a network share or a download
  carries a hidden flag saying it came from outside this machine. `start.cmd` now
  clears that flag automatically with `Unblock-File` before it starts the server.
- **Group Policy.** If your IT department sets the PowerShell execution policy
  through Group Policy, that **overrides** the `-ExecutionPolicy Bypass` switch in
  `start.cmd`. Nothing in this folder can change that, by design.

If you answer **R** and the app still does not appear, the server is probably running
fine but the launcher gave up waiting before you answered. Run `start.cmd` again: it
notices the running server and just opens the window.

If the prompt comes back every time, stop fighting it and use **Way A**. It needs no
scripts at all.

---

## Where your data lives

You are asked once, and can change it in **Settings**.

**A OneDrive folder (recommended).** Plain JSON files in a folder you pick, normally
`OneDrive\TC-Budget`. OneDrive syncs it, backs it up, and keeps version history.
Right-click that folder in Explorer and choose **Always keep on this device** so
OneDrive never leaves a cloud-only placeholder behind.

**This browser.** Everything stays inside the browser profile on this machine. It
survives closing the app and restarting the laptop, but it is not backed up, and
clearing browsing data erases it. Take a backup from **Settings → Download a backup**.

### If you might use both ways of launching

**Use the OneDrive folder.** A browser keeps storage separately per address, and
`file:///C:/...` and `http://localhost:47800` are different addresses to it. Data you
key in *browser* storage under one will not appear under the other. The OneDrive
folder is just files on disk, so it is the same data whichever way you launch, and
you only have to re-pick the folder once on each.

You can also move everything between machines with **Settings → Download a backup**
and **Restore from a backup**.

---

## Updating to a new version

Copy the new `dist\`, `standalone\` and `server\` folders over the old ones. Your data
is in your storage folder, not in the application, so nothing is lost. The desktop
shortcut keeps working: it points at a path, and the file at that path is now newer.

---

## Troubleshooting

**"The built application is missing".** Only one `.cmd` file was copied. Copy the
whole folder.

**The app opens but everything is empty.** If you use a OneDrive folder, it may still
be a cloud-only placeholder. Right-click it in Explorer → **Always keep on this
device**, then **Settings → Reload**.

**"Could not listen on port 47800".** Something else is using it. Edit `start.cmd` and
change `set "PORT=47800"` to another number above 1024.

**Edge asks for folder permission every time.** Edge remembers the folder but re-asks
for permission after a restart. One click on **Reconnect** restores it.

**A save fails with a OneDrive message.** OneDrive briefly locks files while
uploading. The app retries five times with a growing delay. Wait a moment and press
**Save** again; nothing is lost, your edits are still in the window.

**A red "conflict copies" banner.** Two machines wrote to the folder at once and
OneDrive kept both versions. The app never merges them. Open the folder, compare the
files it names, keep one, delete the other, then **Settings → Reload**.

---

## For developers (a machine that does have Node)

```
npm install
npm test               # engine, storage, rollup and import-format suites
npm run dev            # dev server with hot reload
npm run build:all      # rebuilds both dist/ and standalone/ — commit the result
npm run serve          # Node version of the local server
TC_WORKBOOK=path\to\TC_P6_Budget_SCurve.xlsx npm test   # parity against the real workbook
```

`dist/` and `standalone/` are committed on purpose: they are the delivered product for
a laptop that cannot build them. Re-run `npm run build:all` and commit the output
whenever you change anything under `src/`.
