# LulzBot Firmware Web Tool

A static browser application for selecting and flashing LulzBot printer firmware. The flasher supports ATSAM3X8E boards with BOSSA/SAM-BA (`.bin`) and AVR boards with STK500v2 (`.hex`).

## Run locally

Use a local web server rather than opening the HTML file directly. Web Serial requires a secure context, and browsers treat `localhost` as secure. From the repository root, run:

```powershell
cd outputs
python -m http.server 8000 --bind 127.0.0.1
```

Then open <http://localhost:8000/index.html> in a Chromium-based browser such as Chrome or Edge. Stop the server with **Ctrl+C**.

## Choose firmware

In Step 1, either:

- Select **Find firmware by printer and options** to open the firmware selector. Download a match with **Download firmware**, or choose **Use this firmware** to return it to the flasher; or
- Select **Choose a local file on this PC** to use a `.bin` or `.hex` file from your computer.

Catalog selection is currently for local testing. The selector reads configuration data from `firmware-configurations.json` and loads the selected firmware by filename from `outputs/firmware/`. That folder is ignored by Git and must be populated locally. The firmware lookup and download from `firmware.lulzbot.com` are not connected yet. If the selected filename is not present in the local folder, the flasher reports that it could not load it.

The catalog is based on Cura LE 4.13 mappings, plus the supplied PlatformIO build environment list. Active build entries appear first, followed by legacy firmware entries. Some inferred filenames and configurations may not have matching files in the local test folder.

## Flashing workflow

1. Select a catalog configuration or local firmware image.
2. Connect the printer in Step 2. For `.bin` firmware, a printer running Marlin is reset at 1200 baud; select its newly enumerated BOSSA bootloader port when prompted in Step 3. A printer already in BOSSA mode can be selected directly. For `.hex` firmware, select the printer's Marlin serial port.
3. Confirm that the firmware matches the printer and configuration, then erase, flash, and verify.

The flasher checks the controller before enabling firmware writes. Keep the printer powered and connected during erase, write, and verify.

## Project files

- `outputs/index.html` — main interface and flashing workflow
- `outputs/firmware-selector.html` — printer, toolhead, and option selector
- `outputs/firmware-configurations.json` — firmware catalog and compatibility mappings
- `outputs/bossa-bundle.js` — browser BOSSA implementation
- `outputs/avr-stk500v2.js` — browser STK500v2 programmer and Intel HEX parser
- `outputs/firmware/` — local firmware files for testing; ignored by Git
- `outputs/THIRD-PARTY-NOTICES.txt` — bundled code license notices
- `work/prototype.js` — standalone prototype application script
