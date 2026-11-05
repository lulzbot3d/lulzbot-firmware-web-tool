const $ = (id) => document.getElementById(id);
let file = null,
  port = null,
  transport = null,
  programmer = null,
  busy = false,
  chipValidated = false,
  phaseBase = 0,
  phaseScale = 45;
const EXPECTED_CHIP = 0x285e0a60,
  MAX_FLASH_BYTES = 512 * 1024,
  MARLIN_FILTER = { usbVendorId: 0x27b1, usbProductId: 0x0001 },
  BOOTLOADER_FILTER = { usbVendorId: 0x03eb, usbProductId: 0x6124 };
const say = (msg, kind = "") => {
  $("state").textContent = msg;
  $("state").dataset.kind = kind;
};
const log = (msg) => {
  $("log").textContent += msg + "\n";
  $("log").scrollTop = $("log").scrollHeight;
};
function update() {
  $("flash").disabled = !(
    file &&
    port &&
    chipValidated &&
    $("ack").checked &&
    !busy
  );
}
class WebSerialTransport {
  constructor(device) {
    this.device = device;
    this.reader = null;
    this.writer = null;
    this.pendingRead = null;
    this.buffer = new Uint8Array(0);
    this.encoder = new TextEncoder();
    this.isOpen = false;
  }
  async open(baudRate) {
    await this.device.open({ baudRate, bufferSize: 65536 });
    this.isOpen = true;
    this.reader = this.device.readable.getReader();
    this.writer = this.device.writable.getWriter();
  }
  _nextRead() {
    if (!this.pendingRead) this.pendingRead = this.reader.read();
    return this.pendingRead;
  }
  async read(length) {
    const output = new Uint8Array(length);
    for (let i = 0; i < length; ) {
      if (this.buffer.length === 0) {
        let timer;
        let pendingRead;
        try {
          pendingRead = this._nextRead();
          const { value, done } = await Promise.race([
            pendingRead,
            new Promise(
              (_, reject) =>
                (timer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `Timed out waiting for BOSSA serial data (${i}/${length} bytes received)`,
                      ),
                    ),
                  5000, // Match Drunken Octopus's 5-second read timeout.
                )),
            ),
          ]);
          // Retain unread results after a timeout so late USB data is not lost.
          this.pendingRead = null;
          if (done)
            throw new Error("Printer disconnected during BOSSA communication");
          this.buffer = value || new Uint8Array(0);
        } catch (error) {
          if (pendingRead) {
            pendingRead.catch(() => {
              if (this.pendingRead === pendingRead) this.pendingRead = null;
            });
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
      }
      const take = Math.min(length - i, this.buffer.length);
      output.set(this.buffer.subarray(0, take), i);
      i += take;
      this.buffer = this.buffer.slice(take);
    }
    return output;
  }
  write(data) {
    return this.writer.write(
      typeof data === "string" ? this.encoder.encode(data) : data,
    );
  }
  flush() {
    // Match BOSSAC's 1 ms USB serial flush delay between SAM-BA transfers.
    return this.wait(1);
  }
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  setDTR(value) {
    return this.device.setSignals({ dataTerminalReady: value });
  }
  getInfo() {
    return this.device.getInfo();
  }
  async close() {
    try {
      if (this.reader) await this.reader.cancel();
    } catch (e) {}
    try {
      if (this.writer) this.writer.releaseLock();
    } catch (e) {}
    try {
      if (this.reader) this.reader.releaseLock();
    } catch (e) {}
    try {
      if (this.isOpen) await this.device.close();
    } catch (e) {}
    this.isOpen = false;
    this.reader = this.writer = null;
  }
}
$("firmware").addEventListener("change", (e) => {
  file = e.target.files[0] || null;
  $("filename").textContent = file ? file.name : "No file selected";
  $("filesize").textContent = file
    ? `${(file.size / 1024).toFixed(1)} KB · ${file.size.toLocaleString()} bytes`
    : "Select a .bin firmware image";
  if (file && !file.name.toLowerCase().endsWith(".bin")) {
    file = null;
    say("Choose a raw .bin image.", "error");
  } else if (file && file.size > MAX_FLASH_BYTES) {
    file = null;
    $("firmware").value = "";
    $("filename").textContent = "No file selected";
    $("filesize").textContent = "Maximum ATSAM3X8E image size is 512 KB";
    say("This image is too large for ATSAM3X8E flash.", "error");
  } else
    say(
      file
        ? "Image ready. Confirm the board before flashing."
        : "Select a file and connect a board to continue.",
    );
  update();
});
$("ack").addEventListener("change", update);
if (!("serial" in navigator)) {
  $("connect").disabled = true;
  $("portstatus").textContent =
    "Web Serial unavailable — use Chromium over HTTPS or localhost";
}
async function disconnect() {
  busy = true;
  update();
  try {
    if (transport) await transport.close();
  } finally {
    port = transport = programmer = null;
    chipValidated = false;
    $("selectBootloader").hidden = true;
    $("portstatus").textContent = "No device connected";
    $("connect").textContent = "Connect to printer";
    $("connect").onclick = connectHandler;
    say("Disconnected.");
    busy = false;
    update();
  }
}
async function connectHandler() {
  busy = true;
  update();
  let candidate = null;
  try {
    candidate = await navigator.serial.requestPort({
      filters: [MARLIN_FILTER, BOOTLOADER_FILTER],
    });
    const info = candidate.getInfo();
    const isMarlin =
      info.usbVendorId === MARLIN_FILTER.usbVendorId &&
      info.usbProductId === MARLIN_FILTER.usbProductId;
    if (isMarlin) {
      say("Restarting printer into its bootloader…");
      log("Marlin printer selected; requesting bootloader reset.");
      const resetTransport = new WebSerialTransport(candidate);
      try {
        await resetTransport.open(1200);
        await resetTransport.setDTR(true);
        await resetTransport.wait(100);
        await resetTransport.setDTR(false);
      } finally {
        await resetTransport.close();
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
      $("connect").hidden = true;
      $("selectBootloader").hidden = false;
      $("portstatus").textContent = "Waiting for bootloader selection";
      say(
        "The printer restarted. Select its new bootloader port below. Windows may label it “Bossa Program Port”.",
      );
      log("Waiting for authorization of the printer bootloader port.");
      return;
    }
    await validateBootloaderPort(candidate);
  } catch (e) {
    chipValidated = false;
    if (e.name === "NotFoundError") {
      say("No printer was selected.");
    } else {
      say(`Could not connect to printer: ${e.message}`, "error");
      log(`Connection check: ${e.message}`);
      if (transport) await transport.close();
      port = transport = programmer = null;
      $("portstatus").textContent = "No validated device";
      $("connect").textContent = "Connect to printer";
      $("connect").onclick = connectHandler;
    }
  } finally {
    busy = false;
    update();
  }
}
async function selectBootloaderHandler() {
  busy = true;
  update();
  try {
    const candidate = await navigator.serial.requestPort({
      filters: [BOOTLOADER_FILTER],
    });
    $("selectBootloader").hidden = true;
    $("connect").hidden = false;
    await validateBootloaderPort(candidate);
  } catch (e) {
    if (e.name === "NotFoundError") {
      say("Select the printer bootloader port to continue.");
    } else {
      chipValidated = false;
      say(`Could not validate printer bootloader: ${e.message}`, "error");
      log(`Connection check: ${e.message}`);
      if (transport) await transport.close();
      port = transport = programmer = null;
    }
  } finally {
    busy = false;
    update();
  }
}
async function validateBootloaderPort(candidate) {
  transport = new WebSerialTransport(candidate);
  programmer = new BOSSAApi.BOSSA();
  programmer.onProgress = (p) => {
    $("bar").style.width = `${Math.min(95, phaseBase + p * phaseScale)}%`;
  };
  programmer.onStatus = (msg) => {
    if (!/^(SRAM readback mismatch|Page buffer mismatch)/.test(msg)) {
      say(msg);
    }
    if (!/^(Loading page|Checking page|Programming page|Verifying page)/.test(msg)) {
      log(msg);
    }
  };
  say("Connecting to printer bootloader and checking chip…");
  await programmer.connect(transport);
  log("Port opened at 921600 baud.");
  const chip = programmer.chip.chip_id >>> 0;
  log(`Bootloader: ${programmer.version}`);
  log(`Chip ID: 0x${chip.toString(16).toUpperCase()}`);
  if (chip !== EXPECTED_CHIP)
    throw new Error(
      `Expected ATSAM3X8E (0x285E0A60), found 0x${chip.toString(16).toUpperCase()}`,
    );
  chipValidated = true;
  port = candidate;
  $("portstatus").textContent = "ATSAM3X8E detected · Bossa Program Port";
  $("connect").hidden = false;
  $("connect").textContent = "Disconnect";
  $("connect").onclick = disconnect;
  $("selectBootloader").hidden = true;
  say(
    "ATSAM3X8E verified. Select matching firmware and confirm to continue.",
    "success",
  );
  log("Bootloader connection and chip identification successful.");
}
$("selectBootloader").onclick = selectBootloaderHandler;
$("connect").onclick = connectHandler;
$("flash").addEventListener("click", async () => {
  if (!file || !port || !programmer || !chipValidated || busy) return;
  busy = true;
  $("log").textContent = "";
  $("bar").style.width = "0";
  update();
  try {
    const data = await file.arrayBuffer();
    if (data.byteLength === 0) throw new Error("The selected image is empty.");
    if (data.byteLength > MAX_FLASH_BYTES)
      throw new Error("Image exceeds the ATSAM3X8E 512 KB flash capacity.");
    log(`Image size: ${data.byteLength.toLocaleString()} bytes`);
    phaseBase = 0;
    phaseScale = 45;
    say("Erasing and writing firmware…");
    await programmer.flash_firmware(data);
    log("Write complete.");
    phaseBase = 50;
    phaseScale = 45;
    $("bar").style.width = "50%";
    say("Verifying firmware…");
    await programmer.verify_firmware(data);
    log("Verify successful.");
    $("bar").style.width = "96%";
    say("Setting boot-from-flash and restarting…");
    await programmer.enable_boot_flag();
    await programmer.reset_and_close();
    $("bar").style.width = "100%";
    port = transport = programmer = null;
    chipValidated = false;
    $("portstatus").textContent = "Printer restarted";
    $("connect").textContent = "Connect to printer";
    $("connect").onclick = connectHandler;
    say("Flash and verify completed. Printer restarted.", "success");
  } catch (e) {
    say(`Flash failed: ${e.message}`, "error");
    log(`ERROR: ${e.message}`);
    if (transport) await transport.close();
    port = transport = programmer = null;
    chipValidated = false;
    $("portstatus").textContent = "Disconnected after flash error";
    $("connect").textContent = "Reconnect to printer";
    $("connect").onclick = connectHandler;
  } finally {
    busy = false;
    update();
  }
});
