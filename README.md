# KPatch Next Module

Standalone implementation of KPM support for Magisk/KernelSU

---

## KPM Module Repository

KPMs (KernelPatch Modules) are distributed via a standalone **Kpm-Repo**
project. You don't need to rebuild Kpatch-Next to add or remove KPMs.

**Default repo**: [Zhanfg/Kpm-Repo](https://github.com/Zhanfg/Kpm-Repo)

### Use the default repo

Open the Kpatch-Next WebUI → **KPM Repository** → it auto-fetches the
default manifest on first run.

### Add a custom/forked repo

1. Fork [Zhanfg/Kpm-Repo](https://github.com/Zhanfg/Kpm-Repo)
2. Add your KPM sources in `modules/<id>/` (see
   [Kpm-Repo README](https://github.com/Zhanfg/Kpm-Repo#add-your-own-kpm))
3. Push to `main` — GitHub Actions will compile, sign, and release
   the `.kpm` ZIPs automatically
4. In the Kpatch-Next WebUI → **KPM Repository** → **Add Repository**
5. Paste your fork's manifest URL:
   ```
   https://raw.githubusercontent.com/<your-username>/Kpm-Repo/main/kpm_repo.json
   ```

Full forking guide: [Kpm-Repo README](https://github.com/Zhanfg/Kpm-Repo)

### Ship a custom default repo in your Kpatch-Next fork

If you maintain a Kpatch-Next fork and want to ship a non-default
default KPM repo (e.g. pointing users at your own Kpm-Repo fork):

1. Fork both [KPatch-Next-Module](https://github.com/Zhanfg/KPatch-Next-Module)
   and [Kpm-Repo](https://github.com/Zhanfg/Kpm-Repo)
2. In your Kpatch-Next fork, create a file `repos.json` at the module
   root:
   ```json
   [{ "url": "https://raw.githubusercontent.com/<you>/Kpm-Repo/main/kpm_repo.json",
      "name": "Acme KPMs" }]
   ```
3. Rebuild your Kpatch-Next module. The `customize.sh` installer will
   copy `repos.json` to `/data/adb/kp-next/repos.json` on device; the
   WebUI reads this file before any localStorage or default URL.

---

## Credits

- Patch scripts from [APatch](https://github.com/bmax121/APatch)
- KPatch-Next binaries from [KernelSU-Next/KPatch-Next](https://github.com/KernelSU-Next/KPatch-Next)
- magiskboot binary from [Magisk](https://github.com/topjohnwu/Magisk)

## License

- KPatch-Next-Module is licensed under GNU General Public License v3 [GPL-3.0](/LICENSE)
- KPatch-Next binaries is licensed under GNU General Public License v2 [GPL-2.0](https://www.gnu.org/licenses/gpl-2.0.html)
- magiskboot binary from Magisk is licenced under GNU General Public License v3 [GPL-3.0](https://github.com/topjohnwu/Magisk/blob/master/LICENSE)
- WebUI is licensed under MIT License [MIT](/webui/LICENSE)
