/*
 * Browser STK500v2 AVR flasher derived from the AVR ISP implementation in
 * drunken-octopus-downloader, which is derived from Cura LE's AVR ISP code.
 *
 * Copyright (C) 2020 Ultimaker B.V.
 * Copyright (C) 2020 Aleph Objects, Inc.
 * Copyright (C) 2020 SynDaver Labs, Inc.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at
 * your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public
 * License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * Source reference:
 * https://github.com/drunken-octopus/drunken-octopus-downloader
 */
(function (global) {
  "use strict";

  const CHIP_DATABASE = [
    {
      name: "ATmega1280",
      signature: [0x1e, 0x97, 0x03],
      pageSizeWords: 128,
      pageCount: 512,
    },
    {
      name: "ATmega2560",
      signature: [0x1e, 0x98, 0x01],
      pageSizeWords: 128,
      pageCount: 1024,
    },
  ].map((chip) => ({
    ...chip,
    pageSizeBytes: chip.pageSizeWords * 2,
    flashBytes: chip.pageSizeWords * 2 * chip.pageCount,
  }));

  function decodeIntelHex(input) {
    const text =
      typeof input === "string" ? input : new TextDecoder().decode(input);
    const image = [];
    let extendedAddress = 0;
    let sawEndRecord = false;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (sawEndRecord) {
        throw new Error("Intel HEX contains data after its end record.");
      }
      if (line[0] !== ":") {
        throw new Error("Intel HEX record does not start with a colon.");
      }
      if (!/^[0-9a-f]+$/i.test(line.slice(1))) {
        throw new Error("Intel HEX record contains non-hexadecimal characters.");
      }

      const byteCount = Number.parseInt(line.slice(1, 3), 16);
      const address = Number.parseInt(line.slice(3, 7), 16);
      const recordType = Number.parseInt(line.slice(7, 9), 16);
      if (
        !Number.isInteger(byteCount) ||
        !Number.isInteger(address) ||
        !Number.isInteger(recordType) ||
        line.length !== byteCount * 2 + 11
      ) {
        throw new Error("Intel HEX record has an invalid length or header.");
      }

      const record = [];
      for (let offset = 1; offset < line.length; offset += 2) {
        const value = Number.parseInt(line.slice(offset, offset + 2), 16);
        if (!Number.isInteger(value)) {
          throw new Error("Intel HEX record contains an invalid byte.");
        }
        record.push(value);
      }
      if (record.reduce((sum, value) => sum + value, 0) % 256 !== 0) {
        throw new Error("Intel HEX checksum validation failed.");
      }

      const payload = record.slice(4, 4 + byteCount);
      switch (recordType) {
        case 0: {
          const absoluteAddress = extendedAddress + address;
          if (absoluteAddress + byteCount > 256 * 1024) {
            throw new Error(
              "Intel HEX image exceeds the supported 256 KB AVR flash size.",
            );
          }
          while (image.length < absoluteAddress + byteCount) image.push(0x00);
          for (let index = 0; index < byteCount; index += 1) {
            image[absoluteAddress + index] = payload[index];
          }
          break;
        }
        case 1:
          if (byteCount !== 0) {
            throw new Error("Intel HEX end record must not contain data.");
          }
          sawEndRecord = true;
          break;
        case 2:
          if (byteCount !== 2) {
            throw new Error("Intel HEX segment address record is invalid.");
          }
          extendedAddress = ((payload[0] << 8) | payload[1]) * 16;
          break;
        case 4:
          if (byteCount !== 2) {
            throw new Error("Intel HEX linear address record is invalid.");
          }
          extendedAddress = ((payload[0] << 8) | payload[1]) * 0x10000;
          break;
        case 3:
        case 5:
          // Start segment and start linear address records do not affect flash.
          if (byteCount !== 4) {
            throw new Error("Intel HEX start address record is invalid.");
          }
          break;
        default:
          throw new Error(`Unsupported Intel HEX record type ${recordType}.`);
      }
    }

    if (!sawEndRecord) {
      throw new Error("Intel HEX image is missing its end record.");
    }
    if (image.length === 0) {
      throw new Error("Intel HEX image contains no firmware data.");
    }
    return Uint8Array.from(image);
  }

  class Stk500v2 {
    constructor() {
      this.serial = null;
      this.sequence = 1;
      this.chip = null;
      this.hasChecksum = false;
      this.onProgress = () => {};
      this.onStatus = () => {};
    }

    async connect(serial) {
      if (this.serial) await this.close();
      this.serial = serial;
      await this.serial.open(115200);
      this.sequence = 1;

      this.onStatus("Resetting AVR into its bootloader…");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await this.serial.setDTR(true);
        await this.serial.wait(100);
        await this.serial.setDTR(false);
        await this.serial.wait(100);
      }
      await this.serial.wait(200);
      if (this.serial.discardBuffers) this.serial.discardBuffers();

      this.onStatus("Entering AVR programming mode…");
      try {
        const response = await this.sendMessage([
          0x10, 0xc8, 0x64, 0x19, 0x20, 0x00, 0x53, 0x03, 0xac, 0x53, 0x00,
          0x00,
        ]);
        if (response[0] !== 0x10 || response[1] !== 0x00) {
          throw new Error("AVR bootloader refused programming mode.");
        }

        await this.sendMessage([0x06, 0x80, 0x00, 0x00, 0x00]);
        const checksumResponse = await this.sendMessage([0xee]);
        this.hasChecksum = checksumResponse[1] === 0x00;
        this.serial.timeout = 5;

        const signature = await this.getSignature();
        this.chip = CHIP_DATABASE.find((candidate) =>
          candidate.signature.every((value, index) => value === signature[index]),
        );
        if (!this.chip) {
          throw new Error(
            `Unsupported AVR signature ${signature.map((v) => v.toString(16).padStart(2, "0")).join(":")}.`,
          );
        }
        this.onStatus(`${this.chip.name} detected · STK500v2`);
        return this.chip;
      } catch (error) {
        await this.close();
        throw error;
      }
    }

    async close() {
      if (this.serial) {
        const serial = this.serial;
        this.serial = null;
        await serial.close();
      }
    }

    reset_and_close() {
      return this.close();
    }

    enable_boot_flag() {
      // AVR boot selection is controlled by its fuses; STK500v2 needs no flag.
      return Promise.resolve();
    }

    async sendMessage(data) {
      const frame = [
        0x1b,
        this.sequence,
        (data.length >> 8) & 0xff,
        data.length & 0xff,
        0x0e,
        ...data,
      ];
      const checksum = frame.reduce((value, byte) => value ^ byte, 0);
      frame.push(checksum);

      await this.serial.write(Uint8Array.from(frame));
      await this.serial.flush();
      const expectedSequence = this.sequence;
      this.sequence = (this.sequence + 1) & 0xff;
      return this.receiveMessage(expectedSequence);
    }

    async receiveMessage(expectedSequence) {
      while (true) {
        const start = (await this.serial.read(1))[0];
        if (start !== 0x1b) continue;

        const headerTail = await this.serial.read(4);
        const sequence = headerTail[0];
        const length = (headerTail[1] << 8) | headerTail[2];
        const token = headerTail[3];
        if (token !== 0x0e) continue;

        const bodyAndChecksum = await this.serial.read(length + 1);
        let checksum = 0x1b ^ sequence ^ headerTail[1] ^ headerTail[2] ^ token;
        for (const byte of bodyAndChecksum) checksum ^= byte;
        if (checksum !== 0 || sequence !== expectedSequence) continue;
        return bodyAndChecksum.slice(0, length);
      }
    }

    async sendIsp(command) {
      const response = await this.sendMessage([
        0x1d,
        0x04,
        0x04,
        0x00,
        command[0],
        command[1],
        command[2],
        command[3],
      ]);
      return response.slice(2, 6);
    }

    async getSignature() {
      const signature = [];
      for (let address = 0; address < 3; address += 1) {
        const response = await this.sendIsp([0x30, 0x00, address, 0x00]);
        signature.push(response[3]);
      }
      return signature;
    }

    async flash_firmware(image) {
      this.assertReady(image);
      this.onStatus("Erasing AVR flash…");
      await this.sendIsp([0xac, 0x80, 0x00, 0x00]);
      await this.writeFlash(image);
    }

    async writeFlash(image) {
      const pageSize = this.chip.pageSizeBytes;
      const pageCount = Math.ceil(image.length / pageSize);
      await this.setAddressZero();

      for (let page = 0; page < pageCount; page += 1) {
        const start = page * pageSize;
        const payload = new Uint8Array(pageSize).fill(0xff);
        payload.set(image.subarray(start, Math.min(start + pageSize, image.length)));
        const response = await this.sendMessage([
          0x13,
          (pageSize >> 8) & 0xff,
          pageSize & 0xff,
          0xc1,
          0x0a,
          0x40,
          0x4c,
          0x20,
          0x00,
          0x00,
          ...payload,
        ]);
        if (response[1] !== 0x00) {
          throw new Error(`AVR bootloader failed to write page ${page + 1}.`);
        }
        this.onProgress((page + 1) / pageCount);
        if ((page + 1) % 128 === 0 || page + 1 === pageCount) {
          const blockStart = Math.floor(page / 128) * 128;
          this.onStatus(
            `Writing firmware pages (${blockStart + 1}-${page + 1} of ${pageCount})…`,
          );
        }
      }
    }

    async verify_firmware(image) {
      this.assertReady(image);
      this.onStatus("Verifying AVR firmware…");
      if (this.hasChecksum) {
        await this.verifyChecksum(image);
      } else {
        await this.verifyByReadback(image);
      }
      this.onProgress(1);
      this.onStatus("AVR firmware verify successful.");
    }

    async verifyChecksum(image) {
      await this.sendMessage([
        0x06,
        0x00,
        (image.length >> 17) & 0xff,
        (image.length >> 9) & 0xff,
        (image.length >> 1) & 0xff,
      ]);
      const response = await this.sendMessage([0xee]);
      const received = response[2] | (response[3] << 8);
      let expected = 0;
      for (const byte of image) expected = (expected + byte) & 0xffff;
      if (expected !== received) {
        throw new Error(
          `AVR verify checksum mismatch: expected 0x${expected.toString(16)}, received 0x${received.toString(16)}.`,
        );
      }
    }

    async verifyByReadback(image) {
      await this.setAddressZero();
      const blockSize = 256;
      const blockCount = Math.ceil(image.length / blockSize);
      for (let block = 0; block < blockCount; block += 1) {
        const response = await this.sendMessage([0x14, 0x01, 0x00, 0x20]);
        if (response[1] !== 0x00) {
          throw new Error(`AVR bootloader failed to read block ${block + 1}.`);
        }
        const readback = response.slice(2, 2 + blockSize);
        const start = block * blockSize;
        const count = Math.min(blockSize, image.length - start);
        for (let offset = 0; offset < count; offset += 1) {
          if (readback[offset] !== image[start + offset]) {
            throw new Error(
              `AVR verify mismatch at address 0x${(start + offset).toString(16).toUpperCase()}.`,
            );
          }
        }
        this.onProgress((block + 1) / blockCount);
        if ((block + 1) % 128 === 0 || block + 1 === blockCount) {
          const blockStart = Math.floor(block / 128) * 128;
          this.onStatus(
            `Verifying firmware pages (${blockStart + 1}-${block + 1} of ${blockCount})…`,
          );
        }
      }
    }

    async setAddressZero() {
      await this.sendMessage([
        0x06,
        this.chip.flashBytes > 0xffff ? 0x80 : 0x00,
        0x00,
        0x00,
        0x00,
      ]);
    }

    assertReady(image) {
      if (!this.serial || !this.chip) {
        throw new Error("Connect to a supported AVR printer before flashing.");
      }
      if (!(image instanceof Uint8Array) || image.length === 0) {
        throw new Error("Intel HEX image contains no firmware data.");
      }
      if (image.length > this.chip.flashBytes) {
        throw new Error(
          `${this.chip.name} firmware exceeds its ${Math.round(this.chip.flashBytes / 1024)} KB flash capacity.`,
        );
      }
    }
  }

  global.AVRFlasher = {
    Stk500v2,
    decodeIntelHex,
    chipDatabase: CHIP_DATABASE,
  };
})(window);
