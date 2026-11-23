# Development environment verification

Verified November 18, 2026, before the competition build window. This setup installs existing official tools only; it is not application implementation.

## Observed versions

- Windows Node.js executable: C:/Program Files/nodejs/node.exe, v24.18.0.
- npm: 11.16.0.
- Git: 2.45.1.windows.1.
- Official Even Hub simulator: 0.9.5, installed locally in .tooling.
- Official Even Hub CLI: 0.2.0, installed locally in .tooling.
- SDK registry version observed: 0.0.16; not installed into an application yet.

Both installed tool entry points returned exit code 0 for --version. Simulator --help returned exit code 0 and lists --automation-port. No graphical simulator session, application rendering, microphone capture, or device connection was tested.

## Reinstall the tools

Run from the repository root in PowerShell:

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' ci --prefix .tooling --no-audit --no-fund
```

The .tooling package manifest pins exact versions and package-lock.json records dependency integrity. node_modules is ignored. Tool setup is independent of the future application package.

## Run installed tools

```powershell
& 'C:\Program Files\nodejs\node.exe' '.tooling\node_modules\@evenrealities\evenhub-simulator\bin\index.js' --version
& 'C:\Program Files\nodejs\node.exe' '.tooling\node_modules\@evenrealities\evenhub-cli\main.js' --version
```

Once an actual dev server exists during build week, point the simulator at its URL and add --automation-port 9898 to enable its documented control plane. Verify the real interface on the installed version before writing automation.

## Environment observations

The default shell invocation did not return output during bounded checks. Direct Node child-process execution worked for local tools. Explicit Windows PowerShell worked outside the restricted sandbox for package retrieval.

Registry access inside the restricted environment failed with ENOTFOUND for registry.npmjs.org. The approved external network path successfully queried and installed the official npm packages. This does not prove the future Telegram backend can reach Telegram: verify that separately during implementation. No security settings or certificate checks were disabled.

## Not yet verified

Graphical simulator startup/rendering; WebView/SDK bridge; Telegram credentials and network reachability; pairing; real read/write receipt; application build; packaging; video capture; public repository; DoraHacks registration/submission.
