# LulzBot Firmware Utility Prototype

A static browser prototype for flashing firmware to supported LulzBot printers
over Web Serial. It supports ATSAM3X8E boards with BOSSA/SAM-BA (`.bin`) and
ATmega1280/ATmega2560 AVR boards with STK500v2 (`.hex`).

## Run

Open `outputs/index.html` in a browser that supports Web Serial, such as a
current version of Chrome or Edge. Select a firmware file, then connect the
printer. For `.bin` firmware, a printer running Marlin is reset at 1200 baud;
authorize its newly enumerated BOSSA port when prompted in step 3. A printer
already in BOSSA mode can be selected directly. For `.hex` firmware, select
the printer in step 2; when flashing starts in step 3, the page opens the AVR
serial port at 115200 baud, resets into STK500v2 programming mode, checks the
AVR signature, writes the firmware, and verifies it.

Firmware is selected manually. The page does not yet match firmware to a
printer model, toolhead, or configuration.

## Project files

- `outputs/index.html` — static app interface and flashing workflow
- `outputs/bossa-bundle.js` — browser BOSSA implementation
- `outputs/avr-stk500v2.js` — browser STK500v2 programmer and Intel HEX parser
- `outputs/THIRD-PARTY-NOTICES.txt` — bundled code license notices
- `work/prototype.js` — standalone prototype application script

The local Drunken Octopus reference checkout is excluded from this repository.
