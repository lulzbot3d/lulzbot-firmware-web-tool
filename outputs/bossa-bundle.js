/* Bundled browser BOSSA implementation. Original copyright and LGPL-3.0-or-later notices are retained in each source section. */
(function (global) {
  // Source file: samba.js
  /**
   *
   * @licstart
   *
   * Copyright (C) 2020 ShumaTech
   * Copyright (C) 2020 Ultimaker B.V.
   * Copyright (C) 2020 Aleph Objects, Inc.
   * Copyright (C) 2020 SynDaver Labs, Inc.
   *
   * This program is free software: you can redistribute it and/or modify
   * it under the terms of the GNU Lesser General Public License as published
   * by the Free Software Foundation, either version 3 of the License, or
   * (at your option) any later version.
   *
   * This program is distributed in the hope that it will be useful,
   * but WITHOUT ANY WARRANTY; without even the implied warranty of
   * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   * GNU General Public License for more details.
   *
   * You should have received a copy of the GNU Lesser General Public License
   * along with this program.  If not, see <https://www.gnu.org/licenses/>.
   *
   * @licend
   *
   */

  /**
   * Implements the SAMBA protocol as described here:
   *   http://www.varsanofiev.com/inside/at91_sam_ba.htm
   *   https://sourceforge.net/p/lejos/wiki-nxt/SAM-BA%20Protocol/
   *
   * There seems to be some ambiguity in these documents about whether
   * a command should be terminated with "#" or "#\n". The original
   * bossa code used "#" but it seems "#\n" works better.
   */

  class Samba {
    constructor(serial) {
      this.serial = serial;
    }

    static hex8(val) {
      return val.toString(16).padStart(8, "0");
    }

    static littleEndian(data) {
      return (data[3] << 24) + (data[2] << 16) + (data[1] << 8) + data[0];
    }

    async SetBinary() {
      // Logger.log("...Set binary mode")
      await this.serial.write("N#\n");
      await this.serial.flush();
      await this.serial.read(2); // Expects b'\n\r' here
    }

    async write(addr, data) {
      //cmd = str.encode("S" + str('%0*x' % (8,addr)) + "," + str('%0*x' % (8,len(data)))  + "#");
      const cmd =
        "S" + Samba.hex8(addr) + "," + Samba.hex8(data.length) + "#\n";
      await this.serial.write(cmd);
      await this.serial.flush();
      await this.serial.write(data);
      await this.serial.flush();

      // Logger.log("...Write to addr=" + hex(addr) + " of " + str(size) + " bytes")
    }

    async read(addr, size) {
      // Match BOSSAC's USB workaround for power-of-two reads larger than 32
      // bytes: read the first byte completely before requesting the rest.
      const splitRead = size > 32 && !(size & (size - 1));
      if (splitRead) {
        const firstByte = await this.readByte(addr);
        const remainingSize = size - 1;
        const cmd =
          "R" + Samba.hex8(addr + 1) + "," + Samba.hex8(remainingSize) + "#\n";
        await this.serial.write(cmd);
        const remainingData = await this.serial.read(remainingSize);
        const data = new Uint8Array(size);
        data[0] = firstByte;
        data.set(remainingData, 1);
        return data;
      }

      const cmd = "R" + Samba.hex8(addr) + "," + Samba.hex8(size) + "#\n";
      await this.serial.write(cmd);
      return this.serial.read(size);
    }

    async readByte(address) {
      const cmd =
        "o" + Samba.hex8(address) + ",4#\n";
      await this.serial.write(cmd);
      const bytes = await this.serial.read(1);
      return bytes[0];
    }

    async go(addr) {
      //cmd = str.encode("G" + str('%0*x' % (8,addr)) + "#");
      const cmd = "G" + Samba.hex8(addr) + "#\n";
      await this.serial.write(cmd);
      await this.serial.flush();
      // Logger.log("...Go to addr=" + hex(addr) )
    }

    async version() {
      var version_string = "";
      await this.serial.write("V#\n");
      await this.serial.flush();
      while (true) {
        const data = await this.serial.read(1);
        const s = String.fromCharCode(data[0]);
        if (s == "\r") {
          return version_string.trim();
        }
        version_string += s;
      }
    }

    async chipId() {
      // Read the ARM reset vector
      const vector = await this.readWord(0x0);

      if ((vector & 0xff000000) == 0xea000000) {
        return this.readWord(0xfffff240);
      }
      // Else use the Atmel SAM3 or SAM4 or SAMD registers

      // The M0+, M3 and M4 have the CPUID register at a common addresss 0xe000ed00
      const cpuid_reg = await this.readWord(0xe000ed00);
      const part_no = cpuid_reg & 0x0000fff0;

      // Check if it is Cortex M0+
      if (part_no == 0xc600) {
        return this.readWord(0x41002018) & 0xffff00ff;
      }
      // Else assume M3 or M4
      var cid = await this.readWord(0x400e0740);
      if (cid == 0x0) {
        cid = await this.readWord(0x400e0940);
      }

      return cid;
    }

    async reset() {
      const chip_id = await this.chipId();
      if (chip_id == 0x285e0a60) {
        await this.writeWord(0x400e1a00, 0xa500000d);
      } else {
        console.log("...Reset is not supported for this CPU");
        /* Some linux users experienced a lock up if the serial
               port is closed while the port itself is being destroyed.
               This delay is here to give the time to kernel driver to
               sort out things before closing the port.
             */
        await this.sleepSeconds(0.5);  // was 0.1
      }
    }

    async readWord(address) {
      //cmd = str.encode("w" + str('%0*x' % (8,address)) + ",4#");
      const cmd = "w" + Samba.hex8(address) + ",4#\n";
      await this.serial.write(cmd);
      await this.serial.flush();
      const bytes = await this.serial.read(4);
      const value = Samba.littleEndian(bytes);
      // console.log("...Read from addr=" + hex(address) + "[" + hex(value)+ "]")
      return value;
    }

    async writeWord(address, value) {
      //cmd = str.encode("W" + str('%0*x' % (8,address)) + "," + str('%0*x' % (8,value))  + "#");
      const cmd = "W" + Samba.hex8(address) + "," + Samba.hex8(value) + "#\n";
      await this.serial.write(cmd);
      await this.serial.flush();
    }

    sleepSeconds(s) {
      return this.serial.wait(s * 1000);
    }
  }
  // Source file: bossa_chip_db.js
  /**
   *
   * @licstart
   *
   * Copyright (C) 2020 ShumaTech
   * Copyright (C) 2020 Ultimaker B.V.
   * Copyright (C) 2020 Aleph Objects, Inc.
   * Copyright (C) 2020 SynDaver Labs, Inc.
   *
   * This program is free software: you can redistribute it and/or modify
   * it under the terms of the GNU Lesser General Public License as published
   * by the Free Software Foundation, either version 3 of the License, or
   * (at your option) any later version.
   *
   * This program is distributed in the hope that it will be useful,
   * but WITHOUT ANY WARRANTY; without even the implied warranty of
   * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   * GNU General Public License for more details.
   *
   * You should have received a copy of the GNU Lesser General Public License
   * along with this program.  If not, see <https://www.gnu.org/licenses/>.
   *
   * @licend
   *
   */

  class BossaChipDB {
    static getChip(chip_id) {
      for (const [chip, data] of Object.entries(BossaChipDB.db)) {
        if (data.chip_id == chip_id) {
          return data;
        }
      }
    }
  }

  BossaChipDB.db = {
    // SAMD21
    ATSAMD21J18A: {
      chip_id: 0x10010000,
      flash_type: "nvm",
      addr: 0x00002000,
      pages: 4096,
      size: 64,
      planes: 1,
      lockRegions: 16,
      user: 0x20004000,
      stack: 0x20008000,
      regs: 0x41004000,
      canBrownout: true,
    },
    // SAM7SE:

    // SAM7S

    // SAM7XC

    // SAM7X

    AT91SAMX512: {
      chip_id: 0x275c0a40,
      flash_type: "efc",
      addr: 0x100000,
      pages: 2048,
      size: 256,
      planes: 2,
      lockRegions: 32,
      user: 0x202000,
      stack: 0x220000,
      canBootFlash: true,
    },
    AT91SAMX256: {
      chip_id: 0x275b0940,
      flash_type: "efc",
      addr: 0x100000,
      pages: 1024,
      size: 256,
      planes: 1,
      lockRegions: 16,
      user: 0x202000,
      stack: 0x210000,
      canBootFlash: true,
    },
    AT91SAMX128: {
      chip_id: 0x275a0740,
      flash_type: "efc",
      addr: 0x100000,
      pages: 512,
      size: 256,
      planes: 1,
      lockRegions: 8,
      user: 0x202000,
      stack: 0x208000,
      canBootFlash: true,
    },

    // SAM4S

    // SAM3N

    // SAM3S

    // SAM3U

    // SAM3X
    ATSAM3X8E: {
      chip_id: 0x285e0a60,
      flash_type: "eefc",
      addr: 0x00080000,
      pages: 2048,
      size: 256,
      planes: 2,
      lockRegions: 32,
      user: 0x20001000,
      stack: 0x20010000,
      regs: 0x400e0a00,
      canBrownout: false,
    },

    // SAM3A

    // SAM7L

    // SAM9XE

    ATSAM9XE512: {
      chip_id: 0x329aa3a0,
      flash_type: "eefc",
      addr: 0x200000,
      pages: 1024,
      size: 512,
      planes: 1,
      lockRegions: 32,
      user: 0x300000,
      stack: 0x307000,
      regs: 0xfffffa00,
      canBrownout: true,
    },
    ATSAM9XE256: {
      chip_id: 0x329a93a0,
      flash_type: "eefc",
      addr: 0x200000,
      pages: 512,
      size: 512,
      planes: 1,
      lockRegions: 16,
      user: 0x300000,
      stack: 0x307000,
      regs: 0xfffffa00,
      canBrownout: true,
    },
    ATSAM9XE128: {
      chip_id: 0x329973a0,
      flash_type: "eefc",
      addr: 0x200000,
      pages: 256,
      size: 512,
      planes: 1,
      lockRegions: 8,
      user: 0x300000,
      stack: 0x303000,
      regs: 0xfffffa00,
      canBrownout: true,
    },
  };

  // Source file: wordcopy_applet.js
  /**
   *
   * @licstart
   *
   * Copyright (C) 2020 ShumaTech
   * Copyright (C) 2020 Ultimaker B.V.
   * Copyright (C) 2020 Aleph Objects, Inc.
   * Copyright (C) 2020 SynDaver Labs, Inc.
   *
   * This program is free software: you can redistribute it and/or modify
   * it under the terms of the GNU Lesser General Public License as published
   * by the Free Software Foundation, either version 3 of the License, or
   * (at your option) any later version.
   *
   * This program is distributed in the hope that it will be useful,
   * but WITHOUT ANY WARRANTY; without even the implied warranty of
   * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   * GNU General Public License for more details.
   *
   * You should have received a copy of the GNU Lesser General Public License
   * along with this program.  If not, see <https://www.gnu.org/licenses/>.
   *
   * @licend
   *
   */

  class WordCopyApplet {
    constructor(samba, chip) {
      this.samba = samba;
      this.chip = chip;

      this.dst_addr = 0x00000028;
      this.reset = 0x00000024;
      this.src_addr = 0x0000002c;
      this.stack = 0x00000020;
      this.start = 0x00000000;
      this.words = 0x00000030;
      this.code = Uint8Array.from([
        0x09, 0x48, 0x0a, 0x49, 0x0a, 0x4a, 0x02, 0xe0, 0x08, 0xc9, 0x08, 0xc0,
        0x01, 0x3a, 0x00, 0x2a, 0xfa, 0xd1, 0x04, 0x48, 0x00, 0x28, 0x01, 0xd1,
        0x01, 0x48, 0x85, 0x46, 0x70, 0x47, 0xc0, 0x46, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
      ]);
    }

    async write() {
      await this.samba.write(this.chip.user, this.code);
    }

    async setDstAddr(dstAddr) {
      await this.samba.writeWord(this.chip.user + this.dst_addr, dstAddr);
    }

    async setSrcAddr(srcAddr) {
      await this.samba.writeWord(this.chip.user + this.src_addr, srcAddr);
    }

    async setWords(words) {
      await this.samba.writeWord(this.chip.user + this.words, words);
    }

    async setStack(stack) {
      await this.samba.writeWord(this.chip.user + this.stack, stack);
    }

    async run() {
      // Add one to the start address for Thumb mode
      await this.samba.go(this.chip.user + this.start + 1);
    }

    async runv() {
      // Add one to the start address for Thumb mode
      await this.samba.writeWord(
        this.chip.user + this.reset,
        this.chip.user + this.start + 1,
      );
      // The stack is the first reset vector
      await this.samba.go(this.chip.user + this.stack);
    }
  }
  // Source file: eefc_flash.js
  /**
   *
   * @licstart
   *
   * Copyright (C) 2020 ShumaTech
   * Copyright (C) 2020 Ultimaker B.V.
   * Copyright (C) 2020 Aleph Objects, Inc.
   * Copyright (C) 2020 SynDaver Labs, Inc.
   *
   * This program is free software: you can redistribute it and/or modify
   * it under the terms of the GNU Lesser General Public License as published
   * by the Free Software Foundation, either version 3 of the License, or
   * (at your option) any later version.
   *
   * This program is distributed in the hope that it will be useful,
   * but WITHOUT ANY WARRANTY; without even the implied warranty of
   * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   * GNU General Public License for more details.
   *
   * You should have received a copy of the GNU Lesser General Public License
   * along with this program.  If not, see <https://www.gnu.org/licenses/>.
   *
   * @licend
   *
   */

  class EEFC_Flash {
    constructor(samba, chip) {
      this.samba = samba;
      this.chip = chip;
      this.wordCopy = new WordCopyApplet(samba, chip);
      this.eraseAuto = false;

      this.onBufferA = true;
      // page buffers will have the size of a physical page and will be situated right after the applet
      this.pageBufferA = this.chip.user + 0x1000;
      this.pageBufferB = this.pageBufferA + this.chip.size;
    }

    async start() {
      await this.wordCopy.write();
      // Copying init code from Flash console.log here
      await this.wordCopy.setWords(Math.floor(this.chip.size / 4));
      await this.wordCopy.setStack(this.chip.stack);

      // SAM3 Errata (FWS must be 6)
      await this.samba.writeWord(this.chip.regs + 0x000, 0x600);
      if (this.chip.planes == 2) {
        await this.samba.writeWord(this.chip.regs + 0x200, 0x600);
      }
    }

    async eraseAll() {
      await this.waitFSR();
      await this.writeFCR0(0x5, 0);
      if (this.chip.planes == 2) {
        await this.waitFSR();
        await this.writeFCR1(0x5, 0);
      }
      // Chip erase can take much longer than an ordinary EEFC command.
      // Do not begin loading firmware until both flash planes are ready.
      await this.waitFSR(30);
    }

    setEraseAuto(enable) {
      this.eraseAuto = enable;
    }

    async isLocked() {
      await this.waitFSR();
      await this.writeFCR0(0xa, 0);
      await this.waitFSR();
      const frr0 = await this.readFRR0();
      if (frr0) {
        return true;
      }
      if (this.chip.planes == 2) {
        await this.writeFCR1(0xa, 0);
        await this.waitFSR();
        const frr1 = await this.readFRR1();
        if (frr1) {
          return true;
        }
      }
      return false;
    }

    async getLockRegion(region) {
      if (region >= this.chip.lockRegions) {
        throw Error("RegionError");
      }

      await this.waitFSR();
      if (this.chip.planes == 2 && region >= this.chip.lockRegions / 2) {
        await this.writeFCR1(0xa, 0);
        await this.waitFSR();
        const frr1 = await this.readFRR1();
        if (frr1 & (1 << (region - Math.floor(this.chip.lockRegions / 2)))) {
          return true;
        }
      } else {
        await this.writeFCR0(0xa, 0);
        await this.waitFSR();
        const frr0 = await this.readFRR0();
        if (frr0 & (1 << region)) {
          return true;
        }
      }
      return false;
    }

    async setLockRegion(region, enable) {
      if (region >= this.chip.lockRegions) {
        throw Error("RegionError");
      }

      const regEnabled = await this.getLockRegion(region);
      if (enable != regEnabled) {
        if (this.chip.planes == 2 && region >= this.chip.lockRegions / 2) {
          const page =
            ((region - this.chip.lockRegions / 2) * this.chip.pages) /
            this.chip.lockRegions;
          await this.waitFSR();
          if (enable) {
            await this.writeFCR1(0x8, page);
          } else {
            await this.writeFCR1(0x9, page);
          }
        } else {
          const page = (region * this.chip.pages) / this.chip.lockRegions;
          await this.waitFSR();
          if (enable) {
            await this.writeFCR0(0x8, page);
          } else {
            await this.writeFCR0(0x9, page);
          }
        }
      }
    }

    async getSecurity() {
      await this.waitFSR();
      await this.writeFCR0(0xd, 0);
      await this.waitFSR();
      const frr0 = await this.readFRR0();
      return !!(frr0 & (1 << 0));
    }

    async setSecurity() {
      await this.waitFSR();
      await this.writeFCR0(0xb, 0);
    }

    async getBod() {
      if (!this.chip.canBrownout) {
        return false;
      }
      await this.waitFSR();
      await this.writeFCR0(0xd, 0);
      await this.waitFSR();
      const frr0 = await this.readFRR0();
      return !!(frr0 & (1 << 1));
    }

    async setBod(enable) {
      if (!this.chip.canBrownout) {
        return;
      }
      await this.waitFSR();
      if (enable) {
        await this.writeFCR0(0xb, 1);
      } else {
        await this.writeFCR0(0xc, 1);
      }
    }

    async getBor() {
      if (!this.chip.canBrownout) {
        return false;
      }
      await this.waitFSR();
      await this.writeFCR0(0xd, 0);
      await this.waitFSR();
      const frr0 = await this.readFRR0();
      return !!(frr0 & (1 << 2));
    }

    async setBor(enable) {
      if (!this.chip.canBrownout) {
        return;
      }
      await this.waitFSR();
      if (enable) {
        await this.writeFCR0(0xb, 2);
      } else {
        await this.writeFCR0(0xc, 2);
      }
    }

    async getBootFlash() {
      await this.waitFSR();
      await this.writeFCR0(0xd, 0);
      await this.waitFSR();
      const frr0 = await this.readFRR0();
      if (this.chip.canBrownout) {
        result = !!(frr0 & (1 << 3));
      } else {
        result = !!(frr0 & (1 << 1));
      }
      return result;
    }

    async setBootFlash(enable) {
      await this.waitFSR();
      if (enable) {
        if (this.chip.canBrownout) {
          await this.writeFCR0(0xb, 3);
        } else {
          await this.writeFCR0(0xb, 1);
        }
      } else {
        if (this.chip.canBrownout) {
          await this.writeFCR0(0xc, 3);
        } else {
          await this.writeFCR0(0xc, 1);
        }
      }
      await this.waitFSR();
      await this.samba.sleepSeconds(0.1);  // was 0.01
    }

    async writePage(page) {
      if (page > this.chip.pages) {
        throw Error("FlashPageError");
      }
      await this.wordCopy.setDstAddr(this.chip.addr + page * this.chip.size);
      await this.wordCopy.setSrcAddr(this.activePageBuffer);
      this.onBufferA = !this.onBufferA;
      await this.waitFSR();
      await this.wordCopy.runv();
      if (this.chip.planes == 2 && page >= Math.floor(this.chip.pages / 2)) {
        if (this.eraseAuto) {
          await this.writeFCR1(0x3, page - Math.floor(this.chip.pages / 2));
        } else {
          await this.writeFCR1(0x1, page - Math.floor(this.chip.pages / 2));
        }
      } else {
        if (this.eraseAuto) {
          await this.writeFCR0(0x3, page);
        } else {
          await this.writeFCR0(0x1, page);
        }
      }
      // Leave the alternate SRAM buffer available while EEFC programs this
      // page. The next page can be uploaded before writePage waits for FRDY.
    }

    async readPage(page) {
      if (page > this.chip.page) {
        throw Error("FlashPageError");
      }
      /* The SAM3 firmware has a bug where it returns all zeros for reads
       * directly from the flash so instead, we copy the flash page to
       * SRAM and read it from there.
       */
      await this.wordCopy.setDstAddr(this.activePageBuffer);
      await this.wordCopy.setSrcAddr(this.chip.addr + page * this.chip.size);
      await this.waitFSR();
      await this.wordCopy.runv();
      // The flash-to-SRAM applet returns control before this ROM reliably
      // serves the following R request. Preserve the short settle delay.
      await this.samba.sleepSeconds(0.01);

      return this.samba.read(this.activePageBuffer, this.chip.size);
    }

    async waitFSR(timeoutSeconds = 1) {
      var tries = Math.ceil(timeoutSeconds * 1000);
      var fsr1 = 0x1;
      while (tries-- > 0) {
        const fsr0 = await this.samba.readWord(this.chip.regs + 0x008);
        if (fsr0 & (1 << 1)) {
          throw Error("FlashCmdError");
        }
        if (fsr0 & (1 << 2)) {
          throw Error("FlashLockError");
        }

        if (this.chip.planes == 2) {
          fsr1 = await this.samba.readWord(this.chip.regs + 0x208);
          if (fsr1 & (1 << 1)) {
            throw Error("FlashCmdError");
          }
          if (fsr1 & (1 << 2)) {
            throw Error("FlashLockError");
          }
        }
        if (fsr0 & fsr1 & 0x1) {
          return;
        }
        // Match BOSSA's 100-microsecond pause between flash-status polls.
        await this.samba.sleepSeconds(0.001);  // was 0.01
      }
      throw Error("FlashTimeoutError");
    }

    writeFCR0(cmd, arg) {
      return this.samba.writeWord(
        this.chip.regs + 0x004,
        (0x5a << 24) | (Math.floor(arg) << 8) | cmd,
      );
    }

    writeFCR1(cmd, arg) {
      return this.samba.writeWord(
        this.chip.regs + 0x204,
        (0x5a << 24) | (Math.floor(arg) << 8) | cmd,
      );
    }

    readFRR0() {
      return this.samba.readWord(this.chip.regs + 0x00c);
    }

    readFRR1() {
      return this.samba.readWord(this.chip.regs + 0x20c);
    }

    // ------------ Adding Functions common to Flash console.log here for now -------------
    async lockAll() {
      for (var region = 0; region < this.chip.lockRegions; region++) {
        await this.setLockRegion(region, true);
      }
    }

    async unlockAll() {
      for (var region = 0; region < this.chip.lockRegions; region++) {
        await this.setLockRegion(region, false);
        // This is not part of the original bossa implementation.
        // Added for more robustness to serial errors.
        if (await this.getLockRegion(region)) {
          console.log("Retrying flash lock on", region);
          await this.setLockRegion(region, false);
        }
      }
    }

    loadBuffer(data) {
      return this.samba.write(this.activePageBuffer, data);
    }

    readBuffer() {
      return this.samba.read(this.activePageBuffer, this.chip.size);
    }

    get activePageBuffer() {
      return this.onBufferA ? this.pageBufferA : this.pageBufferB;
    }

    writeBuffer(dst_addr, size) {
      return this.samba.writeBuffer(
        this.activePageBuffer,
        dst_addr + this.chip.addr,
        size,
      );
    }

    checksumBuffer(start_addr, size) {
      return this.samba.checksumBuffer(start_addr + this.chip.addr, size);
    }

    pageSize() {
      return this.chip.size;
    }

    numPages() {
      return this.chip.pages;
    }
  }
  // Source file: bossa.js
  /**
   * BOSSA.js is a JavaScript rewrite of BOSSAPY from Cura LE
   * BOSSAPY is python3 rewrite of https://github.com/shumatech/BOSSA
   *
   * BOSSA is a flash programming utility for Atmel's SAM family of flash-based
   * ARM microcontrollers. The motivation behind BOSSA is to create a simple,
   * easy-to-use, open source utility to replace Atmel's SAM-BA software. BOSSA
   * is an acronym for Basic Open Source SAM-BA Application to reflect that goal.
   *
   * @licstart
   *
   * Copyright (C) 2020, ShumaTech
   * Copyright (C) 2020 Ultimaker B.V.
   * Copyright (C) 2020 Aleph Objects, Inc.
   * Copyright (C) 2020 SynDaver Labs, Inc.
   *
   * This program is free software: you can redistribute it and/or modify
   * it under the terms of the GNU Lesser General Public License as published
   * by the Free Software Foundation, either version 3 of the License, or
   * (at your option) any later version.
   *
   * This program is distributed in the hope that it will be useful,
   * but WITHOUT ANY WARRANTY; without even the implied warranty of
   * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   * GNU General Public License for more details.
   *
   * You should have received a copy of the GNU Lesser General Public License
   * along with this program.  If not, see <https://www.gnu.org/licenses/>.
   *
   * @licend
   */

  // Comment out the following when building as Electron app:
  //import {SequentialSerial}   from '../SequentialSerial.mjs';

  class SerialError extends Error {}

  class BOSSA {
    constructor() {
      this.serial = null;
      this.chip = false;
      this.samba = null;
      this.flash = null;
      this.onStatus = () => {};
    }

    static compareArray(a, b, len) {
      if (a.length < len || b.length < len) return false;
      for (let i = 0; i < len; i++) {
        if (a[i] != b[i]) {
          return false;
        }
      }
      return true;
    }

    async reset_to_bootloader(port) {
      console.log("...Initializing serial with ", port);
      this.serial = port;
      await this.serial.open(1200);
      await this.serial.setDTR(true);
      await this.serial.wait(100);
      await this.serial.setDTR(false);
      await this.serial.close();

      // After this new serial device should appear within max 5 seconds..
      await this.serial.wait(5000);
      this.serial = null;
    }

    async connect(port) {
      console.log("...Trying to connect with bootloader on", port);

      this.serial = port;
      await this.serial.open(921600);

      this.samba = new Samba(this.serial);

      await this.samba.SetBinary();
      const cid = await this.samba.chipId();
      console.log("...ChipID =", cid.toString(16));

      /* Read the sam-ba version to detect if extended commands are available
       * NOTE: we MUST call version() after chipId(), otherwise sam-ba did not
       * answer correctly on some devices when used from UART.
       * The reason is unknown.
       */
      const ver = await this.samba.version();
      this.version = ver;
      console.log("...SAM-BA version = [", ver, "]");

      this.chip = BossaChipDB.getChip(cid);
      if (!this.chip) {
        throw new Error(
          "Chip with signature: " + cid.toString(16) + " not found",
        );
      }

      if (this.chip.flash_type == "eefc") {
        this.flash = new EEFC_Flash(this.samba, this.chip);
      } else {
        this.flash = null;
        throw new Error("Unsupported flash type");
      }

      await this.flash.start();
    }

    async flash_firmware(arrayBuffer, maxRetries = 3) {
      const data = new Uint8Array(arrayBuffer);
      console.log("...Flashing firmware");

      this.onStatus("Unlocking flash regions…");
      console.log("...Unlock all regions");
      await this.flash.unlockAll();
      // Match the proven BOSSA sequence used with this board: allow the
      // EEFC unlock operation to settle before issuing the erase command.
      this.onStatus("Waiting for flash unlock to settle…");
      await this.samba.sleepSeconds(0.5);  // was 2

      this.onStatus("Erasing flash…");
      console.log("...Erase flash");
      await this.flash.eraseAll();
      await this.flash.setEraseAuto(false);

      const file_size = data.length;
      const page_size = this.flash.pageSize();

      const num_pages = Math.floor((file_size + page_size - 1) / page_size);
      if (num_pages > this.flash.numPages()) {
        throw new Error("FileSizeError");
      }
      console.log(
        "...Write",
        file_size,
        "bytes to flash (",
        num_pages,
        "pages)",
      );
      this.onStatus(
        `Writing firmware pages (0-${Math.min(127, num_pages - 1)} of ${num_pages})…`,
      );

      // Using Legacy write
      for (let page = 0; page < num_pages; page++) {
        this.onProgress(page / num_pages);
        if (page % 128 === 0)
          this.onStatus(
            `Writing firmware pages (${page}-${Math.min(page + 127, num_pages - 1)} of ${num_pages})…`,
          );
        const offset = page * page_size;
        const pageData = data.slice(offset, offset + page_size);
        await this.flash.loadBuffer(pageData);
        let bufferMatches = false;
        for (let retry = 1; retry <= maxRetries; retry++) {
          const readBack = await this.flash.readBuffer();
          if (BOSSA.compareArray(pageData, readBack, pageData.length)) {
            bufferMatches = true;
            break;
          }

          let mismatchCount = 0;
          let firstMismatch = -1;
          for (let i = 0; i < pageData.length; i++) {
            if (pageData[i] !== readBack[i]) {
              mismatchCount++;
              if (firstMismatch < 0) firstMismatch = i;
            }
          }
          const expectedByte = pageData[firstMismatch]
            .toString(16)
            .padStart(2, "0")
            .toUpperCase();
          const actualByte = (readBack[firstMismatch] ?? 0)
            .toString(16)
            .padStart(2, "0")
            .toUpperCase();
          this.onStatus(
            `SRAM readback mismatch page ${page + 1}: ${mismatchCount} byte(s); first at +0x${firstMismatch.toString(16).toUpperCase()} (expected 0x${expectedByte}, read 0x${actualByte})`,
          );
          if (retry < maxRetries) {
            this.onStatus(
              `Page buffer mismatch; retrying page ${page + 1}/${num_pages}…`,
            );
            await this.samba.readByte(0xdead);
            await this.flash.loadBuffer(pageData);
          }
        }
        if (!bufferMatches) {
          throw new Error(
            `Page ${page + 1} could not be loaded reliably into the SRAM buffer after ${maxRetries} attempts; flash write stopped.`,
          );
        }
        await this.flash.writePage(page);
        if (page % 128 === 127 || page === num_pages - 1) {
          this.onStatus(`Wrote firmware pages (${page + 1}/${num_pages})…`);
        }
      }
      this.onProgress(1);
    }

    async verify_firmware(arrayBuffer) {
      const data = new Uint8Array(arrayBuffer);
      this.onStatus("Verifying firmware…");

      const file_size = data.length;
      const page_size = this.flash.pageSize();

      const num_pages = Math.floor((file_size + page_size - 1) / page_size);
      if (num_pages > this.flash.numPages()) {
        throw new Error("FileSizeError");
      }

      // Verify firmware write
      console.log(
        "...Verifying",
        file_size,
        "bytes from flash (",
        num_pages,
        "pages)",
      );
      for (let page = 0; page < num_pages; page++) {
        this.onProgress(page / num_pages);
        if (page % 128 === 0 || page === num_pages - 1) {
          const blockStart = Math.floor(page / 128) * 128;
          const blockEnd = Math.min(blockStart + 127, num_pages - 1);
          this.onStatus(
            `Verifying firmware pages (${blockStart}-${blockEnd} of ${num_pages})…`,
          );
        }
        const offset = page * page_size;
        const pageData = data.slice(offset, offset + page_size);
        const readBack = await this.flash.readPage(page);
        let mismatchCount = 0;
        let firstMismatch = -1;
        for (let i = 0; i < pageData.length; i++) {
          if (pageData[i] !== readBack[i]) {
            mismatchCount++;
            if (firstMismatch < 0) firstMismatch = i;
          }
        }
        if (mismatchCount > 0) {
          const absoluteOffset = offset + firstMismatch;
          const expected = pageData[firstMismatch]
            .toString(16)
            .padStart(2, "0")
            .toUpperCase();
          const actual = readBack[firstMismatch]
            .toString(16)
            .padStart(2, "0")
            .toUpperCase();
          throw new Error(
            `Write verification failed on page ${page + 1}: ${mismatchCount} byte(s) differ; first at image offset 0x${absoluteOffset.toString(16).toUpperCase()} (expected 0x${expected}, read 0x${actual})`,
          );
        }
        if (page % 128 === 127 || page === num_pages - 1) {
          const blockStart = Math.floor(page / 128) * 128;
          this.onStatus(
            `Verified firmware pages (${blockStart}-${page} of ${num_pages})…`,
          );
        }
      }
      this.onProgress(1);
    }

    async enable_boot_flag() {
      console.log("...Set boot flash true");
      await this.flash.setBootFlash(true);
    }

    async reset_and_close() {
      if (this.samba) {
        console.log("...CPU reset");
        await this.samba.reset();
        // Cura LE allows the reset to settle before closing the serial port.
        await this.samba.sleepSeconds(0.1);
        this.samba = null;
      }

      if (this.serial) {
        console.log("...Closing Serial");
        await this.serial.close();

        // Wait for 5 secs for port to re-appear
        await this.serial.wait(5000);
        this.serial = null;
      }
    }

    // Event handlers which can be overriden by the caller

    // Called with a progress value from 0 to 1
    onProgress(progress) {}
  }
  global.BOSSAApi = { BOSSA, SerialError };
})(window);
