# LulzBot Firmware Utility Prototype

A static browser prototype for flashing firmware to LulzBot printers with
Atmel SAM3X8E boards using the BOSSA/SAM-BA protocol over Web Serial.

## Run

Open `outputs/index.html` in a browser that supports Web Serial, such as a
current version of Chrome or Edge. Select a firmware `.bin` file, connect to
the printer while it is in BOSSA program mode, and follow the on-page steps.

The current prototype targets the ATSAM3X8E board used by the TAZ Pro Archim2.
It accepts a manually selected firmware image; printer, toolhead, and firmware
configuration selection are not implemented yet.

## Project files

- `outputs/index.html` — static app interface and flashing workflow
- `outputs/bossa-bundle.js` — browser BOSSA implementation
- `outputs/THIRD-PARTY-NOTICES.txt` — bundled code license notices
- `work/prototype.js` — standalone prototype application script

The local Drunken Octopus reference checkout is excluded from this repository.
